import { describe, it, expect } from 'vitest';
import { detectUserDevice } from '../src/core/deviceDetection';

describe('deviceDetection', () => {
  describe('iPhone models detection', () => {
    it('detects iPhone 16 Pro Max by dimensions', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        screenWidth: 440,
        screenHeight: 956,
        maxTouchPoints: 5
      });
      expect(dev.isIos).toBe(true);
      expect(dev.isIPhone).toBe(true);
      expect(dev.model).toBe('iPhone 16 Pro Max');
      expect(dev.recommendedWidgetType).toBe('ios-shortcuts');
      expect(dev.platform).toBe('ios');
    });

    it('detects iPhone 15 / 16 or 14 Pro by dimensions', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        screenWidth: 393,
        screenHeight: 852,
        maxTouchPoints: 5
      });
      expect(dev.isIos).toBe(true);
      expect(dev.isIPhone).toBe(true);
      expect(dev.model).toBe('iPhone 15 / 16 or 14 Pro');
      expect(dev.recommendedWidgetType).toBe('ios-shortcuts');
    });

    it('detects iPhone SE by dimensions', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        screenWidth: 375,
        screenHeight: 667,
        maxTouchPoints: 5
      });
      expect(dev.isIos).toBe(true);
      expect(dev.model).toBe('iPhone SE');
    });

    it('detects iPadOS (touch Mac) as iPad', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        screenWidth: 820,
        screenHeight: 1180,
        maxTouchPoints: 5
      });
      expect(dev.isIos).toBe(true);
      expect(dev.isIPad).toBe(true);
      expect(dev.model).toBe('iPad');
      expect(dev.recommendedWidgetType).toBe('ios-scriptable');
    });
  });

  describe('Android devices detection', () => {
    it('detects Google Pixel 8 Pro', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/UD1A.230803.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
        screenWidth: 412,
        screenHeight: 915,
        maxTouchPoints: 5
      });
      expect(dev.isAndroid).toBe(true);
      expect(dev.model).toBe('Google Pixel 8 Pro');
      expect(dev.platform).toBe('android');
      expect(dev.recommendedWidgetType).toBe('android-web');
    });

    it('detects Samsung Galaxy model', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.143 Mobile Safari/537.36',
        screenWidth: 384,
        screenHeight: 832,
        maxTouchPoints: 5
      });
      expect(dev.isAndroid).toBe(true);
      expect(dev.model).toBe('Samsung Galaxy (SM-S928B)');
      expect(dev.platform).toBe('android');
    });

    it('detects OnePlus model', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; CPH2581 Build/UKQ1.230924.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        screenWidth: 450,
        screenHeight: 1000,
        maxTouchPoints: 5
      });
      expect(dev.isAndroid).toBe(true);
      expect(dev.model).toBe('OnePlus (CPH2581)');
    });

    it('falls back cleanly for generic Android UA', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
        screenWidth: 360,
        screenHeight: 800,
        maxTouchPoints: 5
      });
      expect(dev.isAndroid).toBe(true);
      expect(dev.model).toBe('Android Phone');
    });
  });

  describe('Desktop platforms detection', () => {
    it('detects Windows PC', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        maxTouchPoints: 0
      });
      expect(dev.isDesktop).toBe(true);
      expect(dev.isWindows).toBe(true);
      expect(dev.model).toBe('Windows PC');
      expect(dev.recommendedWidgetType).toBe('windows-lockscreen');
      expect(dev.platform).toBe('desktop');
    });

    it('detects Mac desktop without touch', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        maxTouchPoints: 0
      });
      expect(dev.isDesktop).toBe(true);
      expect(dev.isMac).toBe(true);
      expect(dev.model).toBe('Mac');
      expect(dev.recommendedWidgetType).toBe('mac-shortcuts');
    });

    it('detects MacBook Pro 14 by dimensions', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        screenWidth: 1512,
        screenHeight: 982,
        maxTouchPoints: 0
      });
      expect(dev.isMac).toBe(true);
      expect(dev.model).toBe('MacBook Pro 14"');
      expect(dev.modelFamily).toBe('MacBook');
      expect(dev.recommendedWidgetType).toBe('mac-shortcuts');
    });

    it('detects Linux PC', () => {
      const dev = detectUserDevice({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        maxTouchPoints: 0
      });
      expect(dev.isDesktop).toBe(true);
      expect(dev.isLinux).toBe(true);
      expect(dev.model).toBe('Linux PC');
    });
  });
});
