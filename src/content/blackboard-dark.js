// ============================================================
// UoS Blackboard Dark Mode - Content Script (v2.2)
// Safe Isolated-World Theme Manager + Dynamic CSSOM Style Engine
// ============================================================

(() => {
  'use strict';

  const THEME_CLASS = 'bbs-dark-active';
  const LEGACY_UOS_CLASS = 'uos-dark-active';
  // Blackboard's own, unfinished dark mode. Older versions switched it on; it paints pages #666,
  // so it is now only removed (when the old standalone theme is not managing it).
  const BB_DARK_CLASS = 'mode-dark';
  const DYNAMIC_STYLE_ID = 'bbs-dynamic-dark-rules';
  const STATIC_STYLE_ID = 'bbs-static-dark-rules';
  const STATIC_DARK_CSS = `__BBS_STATIC_DARK_CSS__`;

  const prefersDark = () => {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) {
      return false;
    }
  };

  let isEnabled = prefersDark();
  let scanEpoch = 1;
  let sheetState = new WeakMap();
  let rootObserver = null;
  let domObserver = null;
  let intervalId = null;
  let rafId = null;
  let isCleanedUp = false;

  const isContextValid = () => {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  // Notify any previous content script instance in this tab to clean up its observers
  try {
    document.dispatchEvent(new CustomEvent('bbs-dark-reinit'));
  } catch (_) {}

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'PATH', 'G', 'DEFS',
    'CLIPPATH', 'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'CIRCLE',
    'ELLIPSE', 'LINE', 'POLYGON', 'POLYLINE', 'RECT', 'USE', 'SYMBOL',
    'IFRAME', 'OBJECT', 'EMBED'
  ]);

  // Parse rgb(...) / rgba(...) / #hex into { r, g, b, a }
  const parseColor = (str) => {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'unset' || s === 'currentcolor' || s === 'none') {
      return null;
    }
    const rgbMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
    if (rgbMatch) {
      return {
        r: Math.round(parseFloat(rgbMatch[1])),
        g: Math.round(parseFloat(rgbMatch[2])),
        b: Math.round(parseFloat(rgbMatch[3])),
        a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
      };
    }
    const hexMatch = s.match(/#([0-9a-f]{3,8})\b/);
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        return {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
        };
      }
    }
    if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (s === 'black' || s === 'windowtext') return { r: 0, g: 0, b: 0, a: 1 };
    return null;
  };

  // Map a light background color to dark palette variable
  const mapBackground = (c) => {
    if (!c || c.a < 0.15) return null;
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const avg = (r + g + b) / 3;

    if (r >= 250 && g >= 250 && b >= 250) {
      return 'var(--palette-background-b1)'; // #18181b (white cards/surfaces)
    }
    if (r >= 243 && g >= 243 && b >= 243 && spread <= 15) {
      return 'var(--palette-background-b2)'; // #141417 (#f8f8f8 panels/sidebars)
    }
    if (r >= 230 && g >= 230 && b >= 230 && spread <= 20) {
      return 'var(--palette-background-b3)'; // #202024 (#f0f0f0 pills/empty states)
    }
    if (r >= 195 && g >= 195 && b >= 195 && spread <= 22) {
      return 'var(--palette-background-b4)'; // #27272c (#e5e5e5 / #cdcdcd)
    }
    if (avg >= 210) {
      if (r > g + 15 && r > b + 15) return 'var(--palette-error-light)';
      if (g > r + 8 && g >= b) return 'var(--palette-success-light)';
      if (r > 235 && g > 215 && b < 190) return 'var(--palette-warning-light)';
      return 'var(--palette-brand-light)';
    }
    return null;
  };

  // Map a dark text color to light readable text variable
  const mapForeground = (c, bgColor) => {
    if (!c || c.a < 0.2) return null;
    // If the same rule sets a bright saturated status/brand background (e.g. #39e379 green, #00c289 teal, #ffe300 yellow), keep dark contrast text
    if (bgColor && bgColor.a >= 0.5) {
      const bgSpread = Math.max(bgColor.r, bgColor.g, bgColor.b) - Math.min(bgColor.r, bgColor.g, bgColor.b);
      const bgAvg = (bgColor.r + bgColor.g + bgColor.b) / 3;
      if (bgSpread > 45 && bgAvg > 95 && bgAvg < 215) {
        return null;
      }
    }
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const avg = (r + g + b) / 3;

    // Dark primary text (#262626, #000000, #333333)
    if (r <= 68 && g <= 68 && b <= 68) {
      return 'var(--palette-text-primary)';
    }
    // Secondary / hint grey text (#666666, #767676, #8c8c8c)
    if (r >= 69 && r <= 145 && g >= 69 && g <= 145 && b >= 69 && b <= 145 && spread <= 22) {
      return 'var(--palette-text-secondary)';
    }
    // Urgency high / burnt orange (#7D401E, #c75000) used on To-Do calendar badges
    if (r >= 110 && r <= 205 && g >= 45 && g <= 95 && b <= 45) {
      return 'var(--palette-urgency-high)';
    }
    // Dark blue or purple links (#2073a1, #a234b5, #0054bc, #005a9e, #293a53)
    if ((b > r + 25 || r > g + 35) && avg < 155) {
      return 'var(--palette-link-active)';
    }
    return null;
  };

  // Map a light border color to dark border token
  const mapBorderColor = (c) => {
    if (!c || c.a < 0.15) return null;
    const { r, g, b } = c;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (r >= 180 && g >= 180 && b >= 180 && spread <= 25) {
      return 'var(--palette-border-main)';
    }
    return null;
  };

  // Prefix each selector in a comma-separated selector list with html.bbs-dark-active
  const scopeSelector = (selectorText) => {
    if (!selectorText) return '';
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < selectorText.length; i++) {
      const ch = selectorText[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());

    return parts
      .filter(Boolean)
      .map((s) => {
        if (s.startsWith('html.bbs-dark-active')) return s;
        if (/^(html|:root)\b/i.test(s)) {
          return s.replace(/^(html|:root)/i, 'html.bbs-dark-active');
        }
        return `html.bbs-dark-active ${s}`;
      })
      .join(', ');
  };

  // Transform a single CSSStyleRule into a dark-mode override rule string (or '')
  const transformStyleRule = (rule) => {
    const sel = rule.selectorText;
    const st = rule.style;
    if (!sel || !st || st.length === 0) return '';
    if (/thumb|switch-ios|colorRect_|color-selection-live-mode/i.test(sel)) return '';

    const decls = [];
    const bgRaw = st.backgroundColor || st.background;
    const bgColor = parseColor(bgRaw);

    if (bgColor && (!st.backgroundImage || st.backgroundImage === 'none' || !st.backgroundImage.includes('url('))) {
      const mappedBg = mapBackground(bgColor);
      if (mappedBg) {
        decls.push(`background-color: ${mappedBg} !important`);
      }
    }

    if (st.backgroundImage && st.backgroundImage.includes('gradient')) {
      if (/255,\s*255,\s*255|248,\s*248,\s*248|#fff/i.test(st.backgroundImage)) {
        const darkGrad = st.backgroundImage
          .replace(/255,\s*255,\s*255/g, '24, 24, 27')
          .replace(/248,\s*248,\s*248/g, '20, 20, 23')
          .replace(/205,\s*205,\s*205/g, '63, 63, 70')
          .replace(/#ffffff\b|#fff\b/gi, '#18181b');
        decls.push(`background-image: ${darkGrad} !important`);
      }
    }

    if (st.color) {
      const fgColor = parseColor(st.color);
      const mappedFg = mapForeground(fgColor, bgColor);
      if (mappedFg) {
        decls.push(`color: ${mappedFg} !important`);
      }
    }

    // Check border colors
    const bTop = mapBorderColor(parseColor(st.borderTopColor));
    const bRight = mapBorderColor(parseColor(st.borderRightColor));
    const bBottom = mapBorderColor(parseColor(st.borderBottomColor));
    const bLeft = mapBorderColor(parseColor(st.borderLeftColor));

    if (bTop && bRight && bBottom && bLeft) {
      decls.push(`border-color: ${bTop} !important`);
    } else {
      if (bTop) decls.push(`border-top-color: ${bTop} !important`);
      if (bRight) decls.push(`border-right-color: ${bRight} !important`);
      if (bBottom) decls.push(`border-bottom-color: ${bBottom} !important`);
      if (bLeft) decls.push(`border-left-color: ${bLeft} !important`);
    }

    const bBlockStart = mapBorderColor(parseColor(st.borderBlockStartColor));
    const bBlockEnd = mapBorderColor(parseColor(st.borderBlockEndColor));
    const bInlineStart = mapBorderColor(parseColor(st.borderInlineStartColor));
    const bInlineEnd = mapBorderColor(parseColor(st.borderInlineEndColor));
    if (bBlockStart) decls.push(`border-block-start-color: ${bBlockStart} !important`);
    if (bBlockEnd) decls.push(`border-block-end-color: ${bBlockEnd} !important`);
    if (bInlineStart) decls.push(`border-inline-start-color: ${bInlineStart} !important`);
    if (bInlineEnd) decls.push(`border-inline-end-color: ${bInlineEnd} !important`);

    const outlineC = mapBorderColor(parseColor(st.outlineColor));
    if (outlineC) decls.push(`outline-color: ${outlineC} !important`);

    if (st.boxShadow && /255,\s*255,\s*255|#fff/i.test(st.boxShadow)) {
      const darkShadow = st.boxShadow
        .replace(/rgb\(\s*255,\s*255,\s*255\s*\)/gi, '#18181b')
        .replace(/#ffffff\b|#fff\b/gi, '#18181b');
      decls.push(`box-shadow: ${darkShadow} !important`);
    }

    if (decls.length === 0) return '';
    return `${scopeSelector(sel)} { ${decls.join('; ')}; }`;
  };

  // Recursively process CSSRuleList (handles standard rules and @media rules)
  const processRuleList = (rules, startIndex = 0) => {
    const out = [];
    for (let i = startIndex; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.type === 1) {
        // CSSStyleRule
        const res = transformStyleRule(rule);
        if (res) out.push(res);
      } else if (rule.type === 4 && rule.cssRules) {
        // CSSMediaRule
        const nested = processRuleList(rule.cssRules, 0);
        if (nested.length > 0) {
          out.push(`@media ${rule.conditionText || rule.media.mediaText} { ${nested.join(' ')} }`);
        }
      }
    }
    return out;
  };

  // Ensure our static dark stylesheet <style id="bbs-static-dark-rules"> exists in doc
  // This guarantees 100% parity in all iframes and survives extension reloads without tab refresh
  const ensureStaticStyleEl = (doc) => {
    if (!STATIC_DARK_CSS || STATIC_DARK_CSS.startsWith('__BBS_')) return;
    let el = doc.getElementById(STATIC_STYLE_ID);
    if (!el) {
      el = doc.createElement('style');
      el.id = STATIC_STYLE_ID;
      el.textContent = STATIC_DARK_CSS;
      (doc.head || doc.documentElement).appendChild(el);
    }
  };

  // Ensure our companion <style id="bbs-dynamic-dark-rules"> exists in doc
  const getDynamicStyleEl = (doc) => {
    let el = doc.getElementById(DYNAMIC_STYLE_ID);
    if (!el) {
      el = doc.createElement('style');
      el.id = DYNAMIC_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(el);
    }
    return el;
  };

  // Scan all <style> elements in doc (JSS, Emotion speedy CSSOM, Fabric, etc.)
  const scanStyleSheetsInDoc = (doc) => {
    if (!doc || !doc.documentElement) return;
    const styleEls = doc.querySelectorAll('style');
    const newRules = [];

    for (let i = 0; i < styleEls.length; i++) {
      const styleEl = styleEls[i];
      if (styleEl.id === DYNAMIC_STYLE_ID || styleEl.id === STATIC_STYLE_ID || styleEl.id === 'uos-dynamic-dark-rules') continue;
      if (styleEl.classList.contains('vjs-styles-defaults')) continue;

      const text = styleEl.textContent || '';
      if (text.includes('color-selection-live-mode')) continue;

      let rules;
      try {
        if (!styleEl.sheet || !styleEl.sheet.cssRules) continue;
        rules = styleEl.sheet.cssRules;
      } catch (_) {
        continue;
      }

      const ruleCount = rules.length;
      const textLen = text.length;
      const prev = sheetState.get(styleEl);

      if (prev && prev.ruleCount === ruleCount && prev.textLen === textLen) {
        continue;
      }

      // If rules were appended via insertRule (like Emotion speedy mode) and textLen didn't change, scan only new rules
      const startIdx = (prev && prev.textLen === textLen && ruleCount > prev.ruleCount) ? prev.ruleCount : 0;
      const generated = processRuleList(rules, startIdx);
      if (generated.length > 0) {
        newRules.push(...generated);
      }

      sheetState.set(styleEl, { ruleCount, textLen });
    }

    if (newRules.length > 0) {
      const targetStyle = getDynamicStyleEl(doc);
      targetStyle.appendChild(doc.createTextNode('\n' + newRules.join('\n')));
    }
  };

  // Fallback computed-style attribute tagger for any element styled by cross-origin CSS or inline styles
  const scanComputedElementsInDoc = (doc) => {
    if (!isEnabled || !doc || !doc.body) return;
    const win = doc.defaultView || window;
    const elements = doc.body.querySelectorAll('*');
    const len = Math.min(elements.length, 2500);

    // Check if all <link rel="stylesheet"> in doc have finished loading
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    let allLinksLoaded = doc.readyState === 'complete';
    if (allLinksLoaded) {
      for (let k = 0; k < links.length; k++) {
        if (!links[k].sheet) {
          allLinksLoaded = false;
          break;
        }
      }
    }

    const epochPrefix = `${scanEpoch}:`;

    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.id === 'bbs-floating-root' || el.id === 'bbs-toast' || el.closest?.('#bbs-floating-root, #bbs-toast')) continue;

      const cls = typeof el.className === 'string' ? el.className : '';
      const cacheKey = epochPrefix + cls;
      if (allLinksLoaded && el.dataset.bbsCls === cacheKey && el.dataset.bbsPass === '2') continue;

      if (
        cls.includes('MuiSwitch-thumb') ||
        cls.includes('thumb_') ||
        cls.includes('base-navigation-button') ||
        cls.includes('bb-close') ||
        cls.includes('colorRect_')
      ) {
        if (allLinksLoaded) {
          el.dataset.bbsCls = cacheKey;
          el.dataset.bbsPass = '2';
        }
        continue;
      }

      const cs = win.getComputedStyle(el);
      const bg = parseColor(cs.backgroundColor);

      if (bg && bg.a >= 0.5) {
        const spread = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
        if (bg.r >= 250 && bg.g >= 250 && bg.b >= 250) {
          el.setAttribute('data-bbs-bg', 'b1');
        } else if (bg.r >= 242 && bg.g >= 242 && bg.b >= 242 && spread <= 15) {
          el.setAttribute('data-bbs-bg', 'b2');
        } else if (bg.r >= 225 && bg.g >= 225 && bg.b >= 225 && spread <= 20) {
          el.setAttribute('data-bbs-bg', 'b3');
        } else if (bg.r >= 195 && bg.g >= 195 && bg.b >= 195 && spread <= 20) {
          el.setAttribute('data-bbs-bg', 'b4');
        }
      }

      const fg = parseColor(cs.color);
      if (fg && fg.a >= 0.4) {
        // Don't override dark text if background is a bright brand/status color
        let keepDarkText = false;
        // The nearest painted background decides: dark text inside a bright grade pill or badge stays dark
        let paint = bg && bg.a >= 0.5 ? { c: bg, el } : null;
        for (let p = el.parentElement, depth = 0; !paint && p && depth < 4; p = p.parentElement, depth++) {
          const pc = parseColor(win.getComputedStyle(p).backgroundColor);
          if (pc && pc.a >= 0.5) paint = { c: pc, el: p };
        }
        if (paint && !paint.el.hasAttribute('data-bbs-bg')) {
          const c = paint.c;
          const bgSpread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
          const bgAvg = (c.r + c.g + c.b) / 3;
          if (bgSpread > 45 && bgAvg > 95 && bgAvg < 215) {
            keepDarkText = true;
          }
        }
        if (!keepDarkText) {
          const fgSpread = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
          if (fg.r <= 65 && fg.g <= 65 && fg.b <= 65) {
            el.setAttribute('data-bbs-fg', 'pri');
          } else if (fg.r >= 66 && fg.r <= 125 && fg.g >= 66 && fg.g <= 125 && fg.b >= 66 && fg.b <= 125 && fgSpread <= 20) {
            el.setAttribute('data-bbs-fg', 'sec');
          } else if (fg.r >= 110 && fg.r <= 205 && fg.g >= 45 && fg.g <= 95 && fg.b <= 45) {
            el.setAttribute('data-bbs-fg', 'warn');
          }
        }
      }

      if (cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px') {
        const bCol = parseColor(cs.borderTopWidth !== '0px' ? cs.borderTopColor : cs.borderBottomColor);
        if (bCol && mapBorderColor(bCol)) {
          el.setAttribute('data-bbs-border', 'dark');
        }
      }

      if (allLinksLoaded) {
        if (el.dataset.bbsCls === cacheKey) {
          el.dataset.bbsPass = '2';
        } else {
          el.dataset.bbsCls = cacheKey;
          el.dataset.bbsPass = '1';
        }
      }
    }
  };

  const applyThemeToDoc = (doc) => {
    if (!doc || !doc.documentElement) return;
    if (isEnabled) {
      ensureStaticStyleEl(doc);
      doc.documentElement.classList.add(THEME_CLASS);
      if (doc.body) doc.body.classList.add(THEME_CLASS);
      if (!doc.documentElement.classList.contains(LEGACY_UOS_CLASS)) {
        doc.documentElement.classList.remove(BB_DARK_CLASS);
        if (doc.body) doc.body.classList.remove(BB_DARK_CLASS);
      }
      scanStyleSheetsInDoc(doc);
      scanComputedElementsInDoc(doc);
    } else {
      doc.documentElement.classList.remove(THEME_CLASS);
      if (doc.body) doc.body.classList.remove(THEME_CLASS);
      // Only remove mode-dark if standalone uos-blackboard-dark is not actively managing it
      if (!doc.documentElement.classList.contains(LEGACY_UOS_CLASS)) {
        doc.documentElement.classList.remove(BB_DARK_CLASS);
        if (doc.body) doc.body.classList.remove(BB_DARK_CLASS);
      }
    }
  };

  const applyTheme = () => {
    if (isCleanedUp) return;
    applyThemeToDoc(document);
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try {
          if (frame.contentDocument) {
            applyThemeToDoc(frame.contentDocument);
          }
        } catch (_) {}
      });
    } catch (_) {}
  };

  const cleanup = () => {
    isCleanedUp = true;
    if (rootObserver) {
      try { rootObserver.disconnect(); } catch (_) {}
      rootObserver = null;
    }
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  document.addEventListener('bbs-dark-reinit', cleanup, { once: true });

  // Immediate synchronous application at document_start
  applyTheme();

  // Sync with extension storage & popup toggle
  try {
    if (isContextValid()) {
      chrome.storage.local.get(['bbs_settings', 'blackboardDarkMode', 'darkModeEnabled'], (data) => {
        let enabled = prefersDark();
        const theme = data?.bbs_settings?.theme;
        if (theme === 'light') {
          enabled = false;
        } else if (theme === 'dark') {
          enabled = true;
        }
        if (typeof data?.bbs_settings?.blackboardDarkMode === 'boolean') {
          enabled = data.bbs_settings.blackboardDarkMode;
        } else if (typeof data?.blackboardDarkMode === 'boolean') {
          enabled = data.blackboardDarkMode;
        } else if (typeof data?.darkModeEnabled === 'boolean') {
          enabled = data.darkModeEnabled;
        }
        if (isEnabled !== enabled) {
          isEnabled = enabled;
          scanEpoch++;
        }
        applyTheme();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (isCleanedUp) return;
        if (area === 'local') {
          let nextEnabled = null;
          if (changes.bbs_settings?.newValue?.blackboardDarkMode !== undefined) {
            nextEnabled = Boolean(changes.bbs_settings.newValue.blackboardDarkMode);
          } else if (changes.blackboardDarkMode !== undefined) {
            nextEnabled = Boolean(changes.blackboardDarkMode.newValue);
          } else if (changes.darkModeEnabled !== undefined) {
            nextEnabled = Boolean(changes.darkModeEnabled.newValue);
          }
          if (nextEnabled !== null) {
            isEnabled = nextEnabled;
            scanEpoch++;
            applyTheme();
          }
        }
      });

      chrome.runtime.onMessage.addListener((msg) => {
        if (isCleanedUp) return;
        if (msg && (msg.action === 'toggleDarkMode' || msg.type === 'TOGGLE_BLACKBOARD_DARK_MODE')) {
          isEnabled = Boolean(msg.enabled);
          scanEpoch++;
          applyTheme();
        }
      });
    }
  } catch (_) {}

  // Throttled observer to catch dynamic React/JSS/Emotion renders and SPA route changes
  const scheduleScan = () => {
    if (isCleanedUp || !isEnabled || rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyTheme();
    });
  };

  const initObserver = () => {
    if (isCleanedUp || !document.documentElement) return;

    rootObserver = new MutationObserver(() => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      const rootMissing = isEnabled && !document.documentElement.classList.contains(THEME_CLASS);
      const shouldDisable = !isEnabled && document.documentElement.classList.contains(THEME_CLASS);
      if (rootMissing || shouldDisable) {
        applyThemeToDoc(document);
      }
    });

    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    domObserver = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      if (!isEnabled) return;
      let shouldRun = false;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.target && (m.target.id === DYNAMIC_STYLE_ID || m.target.id === STATIC_STYLE_ID)) continue;
        if (m.addedNodes && m.addedNodes.length > 0) {
          shouldRun = true;
          for (let j = 0; j < m.addedNodes.length; j++) {
            const node = m.addedNodes[j];
            if (node.nodeType === 1) {
              if (node.tagName === 'IFRAME') {
                node.addEventListener('load', () => {
                  scanEpoch++;
                  scheduleScan();
                }, { once: true });
              } else if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
                node.addEventListener('load', () => {
                  scanEpoch++;
                  scheduleScan();
                }, { once: true });
              }
            }
          }
        }
      }
      if (shouldRun) {
        scheduleScan();
      }
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Periodic check for CSSOM sheet.insertRule() updates (e.g. Emotion speedy mode) & async renders
    intervalId = setInterval(() => {
      if (!isContextValid()) {
        cleanup();
        return;
      }
      if (isEnabled) {
        applyTheme();
      }
    }, 600);
  };

  if (document.documentElement) {
    initObserver();
  } else {
    document.addEventListener('DOMContentLoaded', initObserver, { once: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    scanEpoch++;
    applyTheme();
  }, { once: true });
  window.addEventListener('load', () => {
    scanEpoch++;
    applyTheme();
  }, { once: true });
})();