import { DeadlineTask } from '../../types';
import { isValidTask } from '../../core/courseHelper';
import { purgeSyntheticGradebookTasks } from '../gradebook';
import {
  areTasksDuplicates,
  deduplicateTaskList,
  mergeCloudTasks,
  mergeDuplicatePair,
  mergeTombstones,
  sanitizeTaskListMarks,
} from '../taskMerge';
import { getStorageTombstones, setStorageTombstones } from '../tombstones';
import {
  STORAGE_KEYS,
  isExtensionContextValid,
  safeGetLocalStorage,
  safeSetLocalStorage,
} from './env';

function readLocalTasks(): DeadlineTask[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (!raw) return [];
  try {
    return sanitizeTaskListMarks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function getCachedTasksSync(): DeadlineTask[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return sanitizeTaskListMarks(parsed.filter(isValidTask));
      }
    } catch {}
  }
  return [];
}

export async function getTasks(): Promise<DeadlineTask[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<DeadlineTask[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.TASKS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                resolve(readLocalTasks());
                return;
              }
              const rawTasks = (result?.[STORAGE_KEYS.TASKS] as DeadlineTask[]) || [];
              const tasks = sanitizeTaskListMarks(rawTasks);
              if (tasks && tasks.length > 0) {
                safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
                if (JSON.stringify(tasks) !== JSON.stringify(rawTasks)) {
                  try {
                    chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks }, () => {});
                  } catch {}
                }
              }
              resolve(tasks);
            } catch {
              resolve(readLocalTasks());
            }
          });
        } catch {
          resolve(readLocalTasks());
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  return readLocalTasks();
}

/**
 * Saves tasks without losing a newer copy that was saved meanwhile: a scan's marks while the
 * popup was busy, or a phone edit while a scan ran. Per task the newer updatedAt wins; tasks
 * only in storage are kept unless deleted (tombstoned) or junk. Returns what was saved.
 */
export async function saveTasksMergingLatest(tasks: DeadlineTask[]): Promise<DeadlineTask[]> {
  let stored: DeadlineTask[] = [];
  let tombstones: Record<string, string> = {};
  try {
    stored = await getTasks();
    tombstones = await getStorageTombstones();
  } catch {}
  // Purge the incoming list first: mergeCloudTasks sanitizes silently, so purging only afterwards would never see these ids
  const pre = purgeSyntheticGradebookTasks(tasks);
  const { tasks: merged } = mergeCloudTasks(pre.cleaned, stored, tombstones);
  const post = purgeSyntheticGradebookTasks(merged);
  const cleaned = deduplicateTaskList(post.cleaned);
  const dedupedAwayIds = post.cleaned
    .map(t => t.id)
    .filter(id => Boolean(id) && !cleaned.some(c => c.id === id));
  const purgedIds = [...pre.purgedIds, ...post.purgedIds, ...dedupedAwayIds];
  if (purgedIds.length > 0) {
    // Tombstone what was purged, as the cloud path does, so the cloud copy cannot bring it back next cycle
    try {
      const nowIso = new Date().toISOString();
      const purged: Record<string, string> = {};
      for (const pid of purgedIds) purged[pid] = nowIso;
      await setStorageTombstones(mergeTombstones(tombstones, purged));
    } catch {}
  }
  await saveTasks(cleaned);
  return cleaned;
}

export async function saveTasks(tasks: DeadlineTask[]): Promise<void> {
  safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks }, () => {
            try {
              if (isExtensionContextValid()) {
                chrome.runtime?.sendMessage?.({ type: 'UPDATE_BADGE' }, () => {
                  if (chrome.runtime?.lastError) {
                    // Background worker may be inactive or sleeping; safely ignore
                  }
                });
              }
            } catch {
              // Context invalidated between set and message; ignore safely
            }
            resolve();
          });
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }
}

export async function addTask(task: DeadlineTask): Promise<DeadlineTask[]> {
  const existing = await getTasks();
  const matchIdx = existing.findIndex(e => areTasksDuplicates(e, task));
  let updated: DeadlineTask[];
  if (matchIdx !== -1) {
    existing[matchIdx] = mergeDuplicatePair(existing[matchIdx], task);
    updated = existing;
  } else {
    updated = [task, ...existing];
  }
  updated = deduplicateTaskList(updated);
  return await saveTasksMergingLatest(updated);
}
