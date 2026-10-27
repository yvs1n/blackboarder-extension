import { DeadlineTask, UserSettings, DEFAULT_SETTINGS, QuickLink } from '../types';
import { pushTasksToFirebase, fetchTasksFromFirebase } from '../utils/firebaseSync';
import { mergeCloudTasks, mergeTombstones } from '../utils/taskMerge';
import { pickNewerList } from '../utils/syncMerge';
import { OPENROUTER_CHAT_URL, aiRequestHeaders, isAllowedAiChatUrl, ifmOriginRule, IFM_ORIGIN_RULE_ID } from '../engine/aiProviders';
import { getUserCourses, getCoursesUpdatedAt, saveUserCourses, getQuickLinksUpdatedAt, saveQuickLinks } from '../utils/storage';
import { initAutoUpdate } from './autoUpdate';
import { IS_STORE_BUILD } from '../utils/storeBuild';
import { registerExtraSiteScripts, getExtraSites, originPattern, EXTRA_SITES_KEY } from '../utils/blackboardSites';
import { dueClassReminders, nextClassReminderAt, classReminderText } from '../core/classSchedule';

const ALARM_NAME = 'bbs_check_deadlines';
const MIDNIGHT_ALARM_NAME = 'bbs_midnight_sync';
const CLASS_ALARM_NAME = 'bbs_class_reminder';
const CLASS_NOTIFIED_KEY = 'bbs_class_notified';

async function classReminderMinutes(): Promise<number> {
  const data = await chrome.storage.local.get(['bbs_settings']) as { bbs_settings?: UserSettings };
  const minutes = data.bbs_settings?.classReminderMinutes;
  return typeof minutes === 'number' && minutes >= 0 ? minutes : DEFAULT_SETTINGS.classReminderMinutes ?? 15;
}

/** Sets one alarm for the next class reminder; it sets the following one when it rings. */
async function scheduleClassReminder() {
  try {
    const minutes = await classReminderMinutes();
    const courses = await getUserCourses();
    const at = nextClassReminderAt(courses, new Date(), minutes);
    await chrome.alarms.clear(CLASS_ALARM_NAME);
    if (at) chrome.alarms.create(CLASS_ALARM_NAME, { when: at.getTime() + 1000 });
  } catch (err) {
    console.error('[Classes] Could not schedule the next class reminder:', err);
  }
}

/** Shows each class reminder that is due and not shown yet. Also run by the 30-minute alarm, in case Chrome was asleep. */
async function showDueClassReminders() {
  try {
    const minutes = await classReminderMinutes();
    if (!minutes) return;
    const courses = await getUserCourses();
    const data = await chrome.storage.local.get([CLASS_NOTIFIED_KEY]) as { [CLASS_NOTIFIED_KEY]?: Record<string, number> };
    const now = new Date();
    const notified: Record<string, number> = {};
    // Keep two days of history; older keys can never be due again
    for (const [k, t] of Object.entries(data[CLASS_NOTIFIED_KEY] || {})) {
      if (now.getTime() - t < 2 * 86400000) notified[k] = t;
    }
    for (const o of dueClassReminders(courses, now, minutes, notified)) {
      notified[o.key] = now.getTime();
      const text = classReminderText(o, now);
      chrome.notifications.create(`class_${o.key}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: text.title,
        message: text.body,
        priority: 2
      });
    }
    await chrome.storage.local.set({ [CLASS_NOTIFIED_KEY]: notified });
  } catch (err) {
    console.error('[Classes] Class reminders failed:', err);
  }
}

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

    // Quick links: the newer list wins, so a change on the phone reaches the extension
    const stored = await chrome.storage.local.get(['bbs_quick_links']) as { bbs_quick_links?: QuickLink[] };
    const localLinks = Array.isArray(stored.bbs_quick_links) ? stored.bbs_quick_links : undefined;
    const linksPick = pickNewerList({ items: localLinks, updatedAt: await getQuickLinksUpdatedAt() }, { items: res.quickLinks, updatedAt: res.quickLinksUpdatedAt }, true);
    if (linksPick.fromCloud && linksPick.items && JSON.stringify(linksPick.items) !== JSON.stringify(localLinks)) {
      await saveQuickLinks(linksPick.items, linksPick.updatedAt);
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

    const fbResult = await pushTasksToFirebase(tasks, isMidnight ? 'Midnight Extension Sync' : 'Extension Auto-Sync', settings.syncKey, data.bbs_quick_links, tombstones, userCourses, coursesUpdatedAt || undefined, (await getQuickLinksUpdatedAt()) || undefined);
    console.log('[Auto-Sync] Firebase Result:', fbResult);
    return { ok: fbResult.success, fbResult };
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
    const extra = (await getExtraSites()).map(originPattern);
    const tabs = await chrome.tabs.query({
      url: [
        '*://*.sharjah.ac.ae/*',
        '*://*.blackboard.com/*',
        'file:///*',
        ...extra
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
    const tabs = await chrome.tabs.query({ url: [...entry.matches, ...(await getExtraSites()).map(originPattern)] });
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
registerExtraSiteScripts().catch(() => {});
scheduleClassReminder();
chrome.permissions?.onAdded?.addListener(() => { registerExtraSiteScripts().catch(() => {}); });
chrome.permissions?.onRemoved?.addListener(() => { registerExtraSiteScripts().catch(() => {}); });

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
    getUserCourses().then(() => scheduleClassReminder()).catch(() => {});
  }
  if (areaName === 'local' && changes.bbs_settings) {
    const before = (changes.bbs_settings.oldValue as Partial<UserSettings> | undefined)?.classReminderMinutes;
    const after = (changes.bbs_settings.newValue as Partial<UserSettings> | undefined)?.classReminderMinutes;
    if (before !== after) scheduleClassReminder();
  }
  if (areaName === 'local' && changes[EXTRA_SITES_KEY]) {
    registerExtraSiteScripts().catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CLASS_ALARM_NAME) {
    showDueClassReminders().then(() => scheduleClassReminder());
  } else if (alarm.name === ALARM_NAME) {
    pullTasksFromFirebaseToLocal().then(() => checkUpcomingDeadlines());
    showDueClassReminders().then(() => scheduleClassReminder());
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
