/**
 * Build channel flags injected by scripts/build.js:
 * - IS_STORE_BUILD: Chrome Web Store / Edge / Firefox store build (no self-updater or nativeMessaging).
 * - IS_DEV_BUILD: Personal unpacked side-by-side test build (dist-dev/, separate extension ID, Debug Stick enabled by default).
 */
declare const __STORE_BUILD__: boolean | undefined;
declare const __DEV_BUILD__: boolean | undefined;

export const IS_STORE_BUILD: boolean = typeof __STORE_BUILD__ !== 'undefined' && __STORE_BUILD__ === true;
export const IS_DEV_BUILD: boolean = typeof __DEV_BUILD__ !== 'undefined' && __DEV_BUILD__ === true;
