import { DeadlineTask, UserSettings, DEFAULT_SETTINGS } from '../types';
import { pushTasksToSyncServer } from '../utils/syncClient';
import { pushTasksToFirebase, fetchTasksFromFirebase } from '../utils/firebaseSync';
import { mergeCloudTasks, mergeTombstones } from '../utils/taskMerge';
import { OPENROUTER_CHAT_URL, aiRequestHeaders, isAllowedAiChatUrl, ifmOriginRule, IFM_ORIGIN_RULE_ID } from '../engine/aiProviders';
import { getUserCourses, getCoursesUpdatedAt, saveUserCourses } from '../utils/storage';
import { initAutoUpdate } from './autoUpdate';
import { IS_STORE_BUILD } from '../utils/storeBuild';

const ALARM_NAME = 'bbs_check_deadlines';
const MIDNIGHT_ALARM_NAME = 'bbs_midnight_sync';

// Schedule daily 12:00 AM midnight alarm for automated sync
function scheduleMidnightAlarm() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime();
  chrome.alarms.create(MIDNIGHT_ALARM_NAME, {
    when: nextMidnight,
    periodInMinutes: 24 * 60
  });
  console.log(`[Auto-Sync] Scheduled daily midnight sync for ${new Date(nextMidnight).toLocaleString()}`);
}

/**
 * Periodically pulls freshest tasks and user customizations from Firebase into chrome.storage.local.
 * Reconciles tasks field-by-field, ensuring course name modifications, room updates, and student notes
 * made on the phone or web app are never lost.
 */
async function pullTasksFromFirebaseToLocal(): Promise<boolean> {
  try {
    const settingsData = await chrome.storage.local.get(['bbs_settings', 'bbs_tombstones']) as {
      bbs_settings?: UserSettings;
      bbs_tombstones?: Record<string, string>;
    };
    const syncKey = settingsData.bbs_settings?.syncKey;
    const res = await fetchTasksFromFirebase(syncKey);
    if (!res.success || !Array.isArray(res.tasks)) {
      return false;
    }

    if (Array.isArray(res.courses)) {
      const localUpdatedAt = await getCoursesUpdatedAt();
      const cloudTime = res.coursesUpdatedAt ? new Date(res.coursesUpdatedAt).getTime() : 0;
      const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0;

      // Only overwrite local courses if cloud timestamp is newer, or if local has no timestamp yet
      if (!localUpdatedAt || cloudTime > localTime) {
        await saveUserCourses(res.courses, res.coursesUpdatedAt);
      }
    }

    const data = await chrome.storage.local.get(['bbs_tasks']) as { bbs_tasks?: DeadlineTask[] };
    const localTasks: DeadlineTask[] = data.bbs_tasks || [];
    const localTombs = settingsData.bbs_tombstones || {};
    const tombstones = mergeTombstones(localTombs, res.tombstones || {});
    if (JSON.stringify(tombstones) !== JSON.stringify(localTombs)) {
      await chrome.storage.local.set({ bbs_tombstones: tombstones });
    }

    const { tasks, changed } = mergeCloudTasks(localTasks, res.tasks, tombstones);
    if (changed) {
      await chrome.storage.local.set({ bbs_tasks: tasks });
      await updateExtensionBadge();
      console.log('[Background Sync] Pulled and merged latest deadlines & course changes from Firebase into storage');
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[Background Sync] Failed pulling tasks from Firebase:', err);
    return false;
  }
}

// Automatically sync latest tasks to mobile sync server & Firebase Cloud
async function syncDeadlinesToMobileServer(isMidnight: boolean = false) {
  try {
    // Proactively pull freshest updates from Firebase BEFORE pushing to prevent overwriting mobile edits
    await pullTasksFromFirebaseToLocal();

    const data = await chrome.storage.local.get(['bbs_tasks', 'bbs_settings', 'bbs_quick_links']) as {
      bbs_quick_links?: any[];
      bbs_tasks?: DeadlineTask[];
      bbs_settings?: UserSettings;
    };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];
    const settings: UserSettings = data.bbs_settings || DEFAULT_SETTINGS;

    if (isMidnight && settings.autoSyncMidnight === false) {
      console.log('[Auto-Sync] Skipped: autoSyncMidnight is disabled in settings');
      return { ok: false, reason: 'disabled' };
    }

    const tombstonesData = await chrome.storage.local.get(['bbs_tombstones']) as { bbs_tombstones?: Record<string, string> };
    const tombstones = tombstonesData.bbs_tombstones || {};
    const userCourses = await getUserCourses();
    const coursesUpdatedAt = await getCoursesUpdatedAt();

    const [fbResult, serverResult] = await Promise.all([
      pushTasksToFirebase(tasks, isMidnight ? 'Midnight Extension Sync' : 'Extension Auto-Sync', settings.syncKey, data.bbs_quick_links, tombstones, userCourses, coursesUpdatedAt || undefined),
      pushTasksToSyncServer(tasks, settings, data.bbs_quick_links, {
        courses: userCourses,
        coursesUpdatedAt: coursesUpdatedAt || undefined,
        tombstones
      })
    ]);
    console.log('[Auto-Sync] Firebase Result:', fbResult, 'Server Result:', serverResult);
    return { ok: fbResult.success || serverResult.success, fbResult, serverResult };
  } catch (err) {
    console.error('[Auto-Sync] Failed syncing to mobile server:', err);
    return { ok: false, error: err };
  }
}

// Update extension icon badge
async function updateExtensionBadge() {
  try {
    const data = await chrome.storage.local.get(['bbs_tasks']) as { bbs_tasks?: DeadlineTask[] };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];

    const now = Date.now();
    const urgentTasks = tasks.filter(t => {
      if (t.status !== 'pending') return false;
      const dueTime = new Date(t.dueDate).getTime();
      const hoursLeft = (dueTime - now) / (1000 * 3600);
      return hoursLeft > -12 && hoursLeft <= 48; // Overdue recently or due in next 48h
    });

    if (urgentTasks.length > 0) {
      await chrome.action.setBadgeText({ text: String(urgentTasks.length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('Failed to update extension badge:', err);
  }
}

// Check for approaching deadlines and send notifications
async function checkUpcomingDeadlines() {
  try {
    const data = await chrome.storage.local.get(['bbs_tasks', 'bbs_settings', 'bbs_notified']) as {
      bbs_tasks?: DeadlineTask[];
      bbs_settings?: UserSettings;
      bbs_notified?: Record<string, number>;
    };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];
    const settings: UserSettings = data.bbs_settings || DEFAULT_SETTINGS;
    const notifiedMap: Record<string, number> = data.bbs_notified || {};

    if (!settings.badgeNotification) return;

    const now = Date.now();
    const alertThresholdMs = settings.reminderHoursBefore * 3600 * 1000;

    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      const dueTime = new Date(task.dueDate).getTime();
      const timeRemaining = dueTime - now;

      // If within notification window (or up to 6 hours overdue on wake) and hasn't been notified in past 12 hours
      if (timeRemaining >= -6 * 3600 * 1000 && timeRemaining <= alertThresholdMs) {
        const lastNotified = notifiedMap[task.id] || 0;
        if (now - lastNotified > 12 * 3600 * 1000) {
          notifiedMap[task.id] = now;

          const hoursLeft = Math.round(timeRemaining / (3600 * 1000));
          const timeText = timeRemaining <= 0
            ? 'now (or overdue)'
            : hoursLeft <= 1
              ? 'under 1 hour'
              : `about ${hoursLeft} hours`;

          chrome.notifications.create(`reminder_${task.id}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `[Urgent] Upcoming ${task.type.toUpperCase()}: ${task.title}`,
            message: `Due ${timeText === 'now (or overdue)' ? timeText : 'in ' + timeText}! Course: ${task.courseCode} - ${task.courseName}`,
            priority: 2
          });
        }
      }
    }

    await chrome.storage.local.set({ bbs_notified: notifiedMap });
    await updateExtensionBadge();
  } catch (err) {
    console.error('Failed checking upcoming deadlines:', err);
  }
}

// Re-inject dark mode CSS and script into any already-open Blackboard tabs so extension reloads never leave tabs unstyled
async function reinjectDarkModeIntoOpenBlackboardTabs() {
  try {
    if (!chrome.tabs?.query || !chrome.scripting) return;
    const tabs = await chrome.tabs.query({
      url: [
        '*://*.sharjah.ac.ae/*',
        '*://*.blackboard.com/*',
        'file:///*'
      ]
    });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id, allFrames: true },
          files: ['blackboard-dark.css']
        });
      } catch {}
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['blackboard-dark.js']
        });
      } catch {}
    }
  } catch {}
}

/*
 * After an update or reload, Chrome cuts already-open tabs off from the extension. Their old
 * scraper stops working (its button says "reload tab"), so load a fresh copy into those tabs.
 */
async function reinjectScraperIntoOpenBlackboardTabs() {
  try {
    if (!chrome.tabs?.query || !chrome.scripting) return;
    const entry = chrome.runtime.getManifest().content_scripts?.find(cs => cs.js?.includes('content.js'));
    if (!entry?.matches || !entry.js) return;
    const tabs = await chrome.tabs.query({ url: entry.matches });
    for (const tab of tabs) {
      if (!tab.id || tab.discarded) continue;
      try {
        if (entry.css?.length) await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: entry.css });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: entry.js });
      } catch {}
    }
  } catch {}
}

// Run immediately when service worker wakes/reloads
reinjectDarkModeIntoOpenBlackboardTabs();

// Updates itself from GitHub (see autoUpdate.ts); the store build leaves updating to the store
if (!IS_STORE_BUILD) initAutoUpdate();

// IFM blocks requests with a browser Origin header; drop it from our own requests to api.ifm.ai
chrome.declarativeNetRequest?.updateDynamicRules({
  removeRuleIds: [IFM_ORIGIN_RULE_ID],
  addRules: [ifmOriginRule(chrome.runtime.id)]
}).catch(err => console.error('[AI] Could not set the IFM header rule:', err));

// Listeners
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
  scheduleMidnightAlarm();
  getUserCourses().catch(() => {});
  reinjectDarkModeIntoOpenBlackboardTabs();
  // A Chrome update keeps content scripts alive, so reload them only after our own install or update
  if (details?.reason === 'install' || details?.reason === 'update') reinjectScraperIntoOpenBlackboardTabs();
  pullTasksFromFirebaseToLocal().then(() => updateExtensionBadge());
});

chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
  scheduleMidnightAlarm();
  getUserCourses().catch(() => {});
  reinjectDarkModeIntoOpenBlackboardTabs();
  pullTasksFromFirebaseToLocal().then(() => checkUpcomingDeadlines());
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.bbs_user_courses) {
    getUserCourses().catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    pullTasksFromFirebaseToLocal().then(() => checkUpcomingDeadlines());
  } else if (alarm.name === MIDNIGHT_ALARM_NAME) {
    syncDeadlinesToMobileServer(true);
    scheduleMidnightAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 2. Content Script Proxy: generative AI chat (bypasses Blackboard page CSP).
  // OpenRouter by default; IFM or a custom OpenAI-compatible URL when the student picked one.
  if (message.type === 'PROXY_OPENROUTER_CHAT') {
    const provider = message.provider === 'ifm' || message.provider === 'custom' ? message.provider : 'openrouter';
    const url = provider === 'openrouter' ? OPENROUTER_CHAT_URL : message.url;
    if (!isAllowedAiChatUrl(url)) {
      sendResponse({ ok: false, error: 'AI URL not allowed' });
      return false;
    }
    const post = (body: any) => fetch(url, {
      method: 'POST',
      headers: aiRequestHeaders(provider, message.apiKey),
      body: JSON.stringify(body)
    });
    post(message.body)
      .then(async res => {
        // Some OpenAI-compatible services refuse JSON mode; ask again without it
        if (res.status === 400 && provider !== 'openrouter' && message.body?.response_format) {
          const { response_format: _omit, ...plain } = message.body;
          res = await post(plain);
        }
        return res;
      })
      .then(async res => {
        const data = await res.json().catch(() => null);
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch(err => {
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  // 3. Trigger Firebase background pull
  if (message.type === 'PULL_FIREBASE') {
    pullTasksFromFirebaseToLocal()
      .then(changed => sendResponse({ ok: true, changed }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    updateExtensionBadge()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'CHECK_DEADLINES') {
    checkUpcomingDeadlines()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'SYNC_TO_SERVER') {
    syncDeadlinesToMobileServer()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup?.().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
