/**
 * True in the build made for the Chrome Web Store and Edge Add-ons (dist-store/). Those stores update
 * the extension themselves and do not allow it to download its own files, so that build has no
 * update helper, no self-update checks and no native messaging permission.
 */
declare const __STORE_BUILD__: boolean | undefined;

export const IS_STORE_BUILD: boolean = typeof __STORE_BUILD__ !== 'undefined' && __STORE_BUILD__ === true;
