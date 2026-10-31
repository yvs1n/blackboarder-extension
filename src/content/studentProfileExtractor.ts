import { isGenericPlaceholderName } from '../scan/blackboardApi';

/**
 * Extracts student profile information (name, id) from the Blackboard page DOM
 * (Ultra base navigation, avatars, user menus, classic header).
 */
export function extractStudentFromBlackboardPage(doc: Document): { studentName?: string; studentId?: string } | null {
  try {
    // 1. Ultra avatar alt text: e.g. "Profile photo of John Doe" or "صورة الملف الشخصي لـ John Doe"
    const avatarImgs = Array.from(doc.querySelectorAll<HTMLImageElement>(
      'img.bb-avatar[alt], bb-avatar img[alt], [class*="avatar"] img[alt], img[alt*="photo of" i], img[alt*="صورة" i]'
    ));
    for (const img of avatarImgs) {
      const alt = (img.getAttribute('alt') || '').trim();
      const cleaned = alt
        .replace(/^(?:profile\s*photo\s*of|photo\s*of|profile\s*picture\s*of)\s+/i, '')
        .replace(/^(?:صورة\s*الملف\s*الشخصي\s*لـ?|صورة\s*الملف\s*الشخصي\s*خاص\s*بـ?|صورة\s+)/i, '')
        .trim();
      if (cleaned && cleaned.length >= 3 && !isGenericPlaceholderName(cleaned)) {
        return { studentName: cleaned };
      }
    }

    // 2. Ultra Base Navigation profile link / button: e.g. <a href="/ultra/user" ...> or <a href="/ultra/profile" ...>
    const profileLinks = Array.from(doc.querySelectorAll<HTMLElement>(
      'a[href*="/ultra/user"], a[href*="/ultra/profile"], [data-analytics-id*="user-profile"], [class*="profile-link"], [class*="base-navigation-button"]'
    ));
    for (const link of profileLinks) {
      const aria = (link.getAttribute('aria-label') || '').trim();
      const ariaCleaned = aria
        .replace(/^(?:user\s*profile\s*for|profile\s*for|profile\s*:|user\s*:)\s+/i, '')
        .replace(/^(?:الملف\s*الشخصي\s*لـ?|الملف\s*الشخصي\s*:)\s+/i, '')
        .trim();
      if (ariaCleaned && ariaCleaned.length >= 3 && !isGenericPlaceholderName(ariaCleaned)) {
        return { studentName: ariaCleaned };
      }
      const nameEl = link.querySelector('[class*="name"], [class*="title"], [class*="label"], span');
      const text = ((nameEl ? nameEl.textContent : link.textContent) || '').trim();
      if (
        text &&
        text.length >= 3 &&
        !isGenericPlaceholderName(text) &&
        !/^(?:profile|user|account|institution|home|stream|courses|organizations|calendar|messages|grades|tools|sign\s*out|log\s*out|الصفحة\s*الرئيسية|المقررات|الدرجات|الرسائل|التقويم|الأدوات)$/i.test(text)
      ) {
        return { studentName: text };
      }
    }

    // 3. Classic Blackboard top navigation: e.g. #global-nav-link, #badge-username, .user-name
    const classicEls = Array.from(doc.querySelectorAll('#global-nav-link, #badge-username, .user-name, .profile-name, [class*="currentUser"]'));
    for (const el of classicEls) {
      const text = (el.textContent || '').trim();
      if (text && text.length >= 3 && !isGenericPlaceholderName(text) && !/^(?:profile|user|account|welcome)$/i.test(text)) {
        return { studentName: text };
      }
    }
  } catch {}
  return null;
}
