import { getProfile, saveProfile } from '../utils/profile';
import { profileUniversity, profileGradeScale } from '../core/studentProfile';
import { getUserCourses, getTasks, isExtensionContextValid } from '../utils/storage';
import { buildGpaSummary } from '../utils/gpa';
import { getAllSyllabi } from '../core/syllabusWeights';
import { isGenericPlaceholderName } from '../scan/blackboardApi';
import { extractStudentFromBlackboardPage } from './studentProfileExtractor';
import { escapeHtml } from '../utils/uiCommon';

export const BADGE_ID = 'bbs-student-profile-badge';

export function isStreamPage(pathname = window.location.pathname): boolean {
  return /^\/ultra\/stream\/?$/i.test(pathname);
}

/** Removes all extra badge cards from the DOM, returning the single remaining card (or null). */
export function cleanDuplicateCards(): HTMLElement | null {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(`#${BADGE_ID}, .bbs-profile-badge-card`));
  if (cards.length === 0) return null;
  for (let i = 1; i < cards.length; i++) {
    cards[i].remove();
  }
  return cards[0];
}

/** Removes all student profile badge cards from the DOM. */
export function removeAllBadgeCards(): void {
  const cards = document.querySelectorAll<HTMLElement>(`#${BADGE_ID}, .bbs-profile-badge-card`);
  cards.forEach(c => c.remove());
}

let started = false;
let isRendering = false;
let renderQueued = false;

/**
 * Injects a Swiss Grid academic student identity card above the activity stream in Blackboard Ultra.
 * Displays the student's name, ID number, university, enrolled courses, and projected GPA.
 */
export async function startStudentProfileBadge(): Promise<void> {
  if (started || !isExtensionContextValid()) return;
  started = true;

  const render = async () => {
    if (!isStreamPage()) {
      removeAllBadgeCards();
      return;
    }

    const stream = document.querySelector('.activity-stream');
    if (!stream) return;

    const profile = await getProfile().catch(() => null);
    if (!profile || (!profile.studentName && !profile.studentId)) {
      removeAllBadgeCards();
      return;
    }

    const uni = profileUniversity(profile);
    const courses = await getUserCourses().catch(() => []);
    const tasks = await getTasks().catch(() => []);
    const syllabi = getAllSyllabi();
    const gpaSummary = buildGpaSummary(tasks, syllabi, profileGradeScale(profile));

    let studentName = profile.studentName;
    if (!studentName || isGenericPlaceholderName(studentName)) {
      const pageStudent = extractStudentFromBlackboardPage(document);
      if (pageStudent?.studentName) {
        studentName = pageStudent.studentName;
        saveProfile({ ...profile, studentName: pageStudent.studentName }).catch(() => {});
      }
    }

    const name = studentName || 'Student';
    const id = profile.studentId ? `ID: ${profile.studentId}` : '';
    const universityName = uni.shortName !== 'Other' ? uni.name : 'University';
    const courseCount = courses.length > 0 ? `${courses.length} Course${courses.length > 1 ? 's' : ''}` : '';
    const gpaDisplay = typeof gpaSummary?.gpa === 'number'
      ? `${gpaSummary.gpa.toFixed(2)} GPA`
      : '';

    // Re-verify stream page after asynchronous operations
    if (!isStreamPage()) {
      removeAllBadgeCards();
      return;
    }

    // Clean up any duplicates that might exist, retaining at most one card
    const existingCard = cleanDuplicateCards();
    const ref = document.getElementById('bbs-activity-filter') || stream;

    let targetCard = existingCard;
    if (!targetCard) {
      targetCard = document.createElement('div');
      targetCard.id = BADGE_ID;
      targetCard.className = 'bbs-profile-badge-card';
      ref.parentElement?.insertBefore(targetCard, ref);
    } else if (targetCard.nextElementSibling !== ref) {
      ref.parentElement?.insertBefore(targetCard, ref);
    }

    const signature = JSON.stringify([name, id, universityName, courseCount, gpaDisplay]);
    if (targetCard.dataset.sig === signature) return;
    targetCard.dataset.sig = signature;

    targetCard.innerHTML = `
      <div class="bbs-pbc-main">
        <div class="bbs-pbc-avatar" aria-hidden="true">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div class="bbs-pbc-details">
          <div class="bbs-pbc-row-primary">
            <span class="bbs-pbc-name">${escapeHtml(name)}</span>
            ${id ? `<span class="bbs-pbc-id">${escapeHtml(id)}</span>` : ''}
          </div>
          <div class="bbs-pbc-row-secondary">
            <span class="bbs-pbc-uni">${escapeHtml(universityName)}</span>
            ${profile.major ? `<span class="bbs-pbc-meta">• ${escapeHtml(profile.major)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="bbs-pbc-stats">
        ${courseCount ? `<span class="bbs-pbc-stat-chip">${escapeHtml(courseCount)}</span>` : ''}
        ${gpaDisplay ? `<span class="bbs-pbc-stat-chip bbs-pbc-gpa-chip">${escapeHtml(gpaDisplay)}</span>` : ''}
        <button type="button" class="bbs-pbc-action" id="bbs-pbc-open-btn" title="Open Blackboarder">Sidekick ↗</button>
      </div>
    `;

    targetCard.querySelector('#bbs-pbc-open-btn')?.addEventListener('click', () => {
      try {
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        }
      } catch {}
    });
  };

  const requestRender = () => {
    if (isRendering) {
      renderQueued = true;
      return;
    }
    isRendering = true;
    renderQueued = false;

    render()
      .catch(() => {})
      .finally(() => {
        isRendering = false;
        if (renderQueued) {
          renderQueued = false;
          requestRender();
        }
      });
  };

  requestRender();

  // Observe navigation changes on Blackboard Ultra SPA
  const observer = new MutationObserver(muts => {
    if (!isStreamPage()) {
      removeAllBadgeCards();
      return;
    }
    // Ignore mutations triggered within the badge card itself or activity filter
    if (muts.every(m => (m.target as Element).closest?.(`#${BADGE_ID}, .bbs-profile-badge-card, #bbs-activity-filter`))) {
      return;
    }

    cleanDuplicateCards();
    if (!document.getElementById(BADGE_ID)) {
      requestRender();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
