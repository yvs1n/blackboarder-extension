/**
 * Device and model detection for Blackboarder.
 * Identifies the student's hardware platform (iPhone models, Android devices, Mac, Windows)
 * to deliver tailored liquid-glass widget recommendations and zero-friction setup options.
 */

export interface DeviceProbe {
  userAgent?: string;
  screenWidth?: number;
  screenHeight?: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
}

export type PlatformType = 'ios' | 'android' | 'desktop';

export interface DetectedDevice {
  isIos: boolean;
  isIPhone: boolean;
  isIPad: boolean;
  isAndroid: boolean;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  isDesktop: boolean;
  platform: PlatformType;
  model: string;
  modelFamily: string;
  recommendedWidgetType: 'ios-shortcuts' | 'ios-scriptable' | 'android-web' | 'android-kwgt' | 'windows-lockscreen' | 'mac-shortcuts' | 'generic';
}

function resolveIPhoneModel(minDim: number, maxDim: number): { model: string; modelFamily: string } {
  // Screen logical points: minDim x maxDim
  if (minDim === 440 && maxDim === 956) {
    return { model: 'iPhone 16 Pro Max', modelFamily: 'iPhone' };
  }
  if (minDim === 402 && maxDim === 874) {
    return { model: 'iPhone 16 Pro', modelFamily: 'iPhone' };
  }
  if (minDim === 430 && maxDim === 932) {
    return { model: 'iPhone 15 / 16 Plus or Pro Max', modelFamily: 'iPhone' };
  }
  if (minDim === 393 && maxDim === 852) {
    return { model: 'iPhone 15 / 16 or 14 Pro', modelFamily: 'iPhone' };
  }
  if (minDim === 428 && maxDim === 926) {
    return { model: 'iPhone 12 / 13 / 14 Pro Max', modelFamily: 'iPhone' };
  }
  if (minDim === 390 && maxDim === 844) {
    return { model: 'iPhone 12 / 13 / 14', modelFamily: 'iPhone' };
  }
  if (minDim === 414 && maxDim === 896) {
    return { model: 'iPhone 11 / XR / XS Max', modelFamily: 'iPhone' };
  }
  if (minDim === 375 && maxDim === 812) {
    return { model: 'iPhone X / 11 Pro / Mini', modelFamily: 'iPhone' };
  }
  if (minDim === 414 && maxDim === 736) {
    return { model: 'iPhone Plus (6 / 7 / 8 Plus)', modelFamily: 'iPhone' };
  }
  if (minDim === 375 && maxDim === 667) {
    return { model: 'iPhone SE', modelFamily: 'iPhone' };
  }
  return { model: 'iPhone', modelFamily: 'iPhone' };
}

function resolveAndroidModel(ua: string): { model: string; modelFamily: string } {
  const match = ua.match(/Android\s+[^;]+;\s*([^;)]+?)\s*(?:Build|[;)])/i);
  if (match && match[1]) {
    const raw = match[1].trim();
    if (raw && !/^(K|en-us|mobile|wv|release)$/i.test(raw)) {
      if (/^SM-[A-Z0-9]+/i.test(raw)) {
        return { model: `Samsung Galaxy (${raw})`, modelFamily: 'Samsung' };
      }
      if (/^Pixel/i.test(raw)) {
        return { model: `Google ${raw}`, modelFamily: 'Pixel' };
      }
      if (/^(CPH|PJA)[0-9]+/i.test(raw)) {
        return { model: `OnePlus (${raw})`, modelFamily: 'OnePlus' };
      }
      if (/^[0-9]{5,}[A-Z]+/i.test(raw) || /^Redmi/i.test(raw) || /^POCO/i.test(raw)) {
        return { model: `Xiaomi (${raw})`, modelFamily: 'Xiaomi' };
      }
      return { model: raw, modelFamily: 'Android' };
    }
  }
  return { model: 'Android Phone', modelFamily: 'Android' };
}

function resolveMacModel(w: number, h: number): { model: string; modelFamily: string } {
  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  if (minDim === 982 && maxDim === 1512) {
    return { model: 'MacBook Pro 14"', modelFamily: 'MacBook' };
  }
  if (minDim === 1117 && maxDim === 1728) {
    return { model: 'MacBook Pro 16"', modelFamily: 'MacBook' };
  }
  if (minDim === 956 && maxDim === 1470) {
    return { model: 'MacBook Air 13"', modelFamily: 'MacBook' };
  }
  if (minDim === 980 && maxDim === 1536) {
    return { model: 'MacBook Air 15"', modelFamily: 'MacBook' };
  }
  if (minDim === 1260 && maxDim === 2240) {
    return { model: 'iMac 24"', modelFamily: 'iMac' };
  }
  return { model: 'Mac', modelFamily: 'Mac' };
}

export function detectUserDevice(probe?: DeviceProbe): DetectedDevice {
  let ua = '';
  let screenWidth = 0;
  let screenHeight = 0;
  let maxTouchPoints = 0;

  if (probe) {
    ua = probe.userAgent || '';
    screenWidth = probe.screenWidth || 0;
    screenHeight = probe.screenHeight || 0;
    maxTouchPoints = probe.maxTouchPoints || 0;
  } else if (typeof window !== 'undefined') {
    const nav = window.navigator as { userAgent?: string; maxTouchPoints?: number };
    ua = nav.userAgent || '';
    screenWidth = window.screen?.width || 0;
    screenHeight = window.screen?.height || 0;
    maxTouchPoints = nav.maxTouchPoints || 0;
  }

  const isTouchMac = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const isIPhone = /iPhone/i.test(ua);
  const isIPad = /iPad/i.test(ua) || isTouchMac;
  const isIos = isIPhone || isIPad || /iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const isMac = /Macintosh/i.test(ua) && !isTouchMac;
  const isLinux = /Linux/i.test(ua) && !isAndroid;
  const isDesktop = (isWindows || isMac || isLinux) && !isIos && !isAndroid;

  let model = 'Your Device';
  let modelFamily = 'Generic';
  let platform: PlatformType = 'desktop';
  let recommendedWidgetType: DetectedDevice['recommendedWidgetType'] = 'generic';

  if (isIos) {
    platform = 'ios';
    if (isIPhone) {
      const minDim = Math.min(screenWidth, screenHeight);
      const maxDim = Math.max(screenWidth, screenHeight);
      const resolved = resolveIPhoneModel(minDim, maxDim);
      model = resolved.model;
      modelFamily = resolved.modelFamily;
      recommendedWidgetType = 'ios-shortcuts';
    } else if (isIPad) {
      model = 'iPad';
      modelFamily = 'iPad';
      recommendedWidgetType = 'ios-scriptable';
    } else {
      model = 'iOS Device';
      modelFamily = 'iOS';
      recommendedWidgetType = 'ios-shortcuts';
    }
  } else if (isAndroid) {
    platform = 'android';
    const resolved = resolveAndroidModel(ua);
    model = resolved.model;
    modelFamily = resolved.modelFamily;
    recommendedWidgetType = 'android-web';
  } else {
    platform = 'desktop';
    if (isWindows) {
      model = 'Windows PC';
      modelFamily = 'Windows';
      recommendedWidgetType = 'windows-lockscreen';
    } else if (isMac) {
      const resolved = resolveMacModel(screenWidth, screenHeight);
      model = resolved.model;
      modelFamily = resolved.modelFamily;
      recommendedWidgetType = 'mac-shortcuts';
    } else if (/CrOS/i.test(ua)) {
      model = 'Chromebook';
      modelFamily = 'ChromeOS';
      recommendedWidgetType = 'generic';
    } else if (isLinux) {
      model = 'Linux PC';
      modelFamily = 'Linux';
      recommendedWidgetType = 'generic';
    }
  }

  return {
    isIos,
    isIPhone,
    isIPad,
    isAndroid,
    isWindows,
    isMac,
    isLinux,
    isDesktop,
    platform,
    model,
    modelFamily,
    recommendedWidgetType
  };
}
