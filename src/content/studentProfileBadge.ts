import { getProfile } from '../utils/profile';
import { profileUniversity, profileGradeScale } from '../core/studentProfile';
import { getUserCourses, getTasks, isExtensionContextValid } from '../utils/storage';
import { buildGpaSummary } from '../utils/gpa';
import { getAllSyllabi } from '../core/syllabusWeights';

const BADGE_ID = 'bbs-student-profile-badge';

export function isStreamPage(pathname = window.location.pathname): boolean {
  return /^\/ultra\/stream\/?$/i.test(pathname);
}

/**
 * Injects a Swiss Grid academic student identity card above the activity stream in Blackboard Ultra.
 * Displays the student's name, ID number, university, enrolled courses, and projected GPA.
 */
export async function startStudentProfileBadge(): Promise<void> {
  if (!isExtensionContextValid()) return;

  const render = async () => {
    const existing = document.getElementById(BADGE_ID);
    if (!isStreamPage()) {
      existing?.remove();
      return;
    }

    const stream = document.querySelector('.activity-stream');
    if (!stream) return;

    const profile = await getProfile().catch(() => null);
    if (!profile || (!profile.studentName && !profile.studentId)) {
      existing?.remove();
      return;
    }

    const uni = profileUniversity(profile);
    const courses = await getUserCourses().catch(() => []);
    const tasks = await getTasks().catch(() => []);
    const syllabi = getAllSyllabi();
    const gpaSummary = buildGpaSummary(tasks, syllabi, profileGradeScale(profile));

    const name = profile.studentName || 'Student';
    const id = profile.studentId ? `ID: ${profile.studentId}` : '';
    const universityName = uni.shortName !== 'Other' ? uni.name : 'University';
    const courseCount = courses.length > 0 ? `${courses.length} Course${courses.length > 1 ? 's' : ''}` : '';
    const gpaDisplay = typeof gpaSummary?.gpa === 'number'
      ? `${gpaSummary.gpa.toFixed(2)} GPA`
      : '';

    let card = existing;
    if (!card || card.nextElementSibling !== stream && card.nextElementSibling?.id !== 'bbs-activity-filter') {
      card?.remove();
      card = document.createElement('div');
      card.id = BADGE_ID;
      card.className = 'bbs-profile-badge-card';
      const ref = document.getElementById('bbs-activity-filter') || stream;
      ref.parentElement?.insertBefore(card, ref);
    }

    const signature = JSON.stringify([name, id, universityName, courseCount, gpaDisplay]);
    if (card.dataset.sig === signature) return;
    card.dataset.sig = signature;

    card.innerHTML = `
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

    card.querySelector('#bbs-pbc-open-btn')?.addEventListener('click', () => {
      try {
        if (isExtensionContextValid()) {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        }
      } catch {}
    });
  };

  await render().catch(() => {});

  // Observe navigation changes on Blackboard Ultra SPA
  const observer = new MutationObserver(() => {
    if (isStreamPage()) {
      if (!document.getElementById(BADGE_ID)) {
        render().catch(() => {});
      }
    } else {
      document.getElementById(BADGE_ID)?.remove();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
