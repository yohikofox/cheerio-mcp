import { chromium, Browser, BrowserContext } from "playwright-core";

/**
 * Browser Manager - Singleton pattern to reuse browser instance across scraping calls
 * This significantly reduces scraping time by avoiding browser launch overhead (~3-5s per call)
 */
class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private lastUsed: number = 0;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Get or create browser instance
   */
  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      console.log("[BrowserManager] Launching new browser instance...");
      const isHeadless = true; //process.env.PLAYWRIGHT_HEADLESS !== 'false';

      this.browser = await chromium.launch({
        headless: isHeadless,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          // Anti-detection flags
          "--disable-blink-features=AutomationControlled",
          "--disable-features=VizDisplayCompositor",
          "--disable-web-security",
          "--disable-features=site-per-process",
          "--disable-ipc-flooding-protection",
          // Realistic window size
          "--window-size=1920,1080",
          "--start-maximized",
          // Additional stealth
          "--no-first-run",
          "--disable-default-apps",
          "--disable-extensions-file-access-check",
          "--disable-extensions-http-throttling",
        ],
      });

      console.log("[BrowserManager] Browser instance created");
    }

    this.lastUsed = Date.now();
    this.scheduleCleanup();

    return this.browser;
  }

  /**
   * Get or create browser context with anti-detection
   */
  async getContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();

    // Reuse context if it exists and is valid
    if (this.context && this.context.pages().length < 10) {
      return this.context;
    }

    // Close old context if it has too many pages
    if (this.context) {
      await this.context.close();
    }

    console.log("[BrowserManager] Creating new browser context...");
    this.context = await browser.newContext({
      // Randomized realistic user agent
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
      // Realistic viewport
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      // Additional realism
      locale: "fr-FR",
      timezoneId: "Europe/Paris",
      geolocation: { latitude: 48.8566, longitude: 2.3522 }, // Paris
      permissions: ["geolocation"],
      acceptDownloads: true,
      // Extra headers to look more human
      extraHTTPHeaders: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    return this.context;
  }

  /**
   * Schedule cleanup of idle browser
   */
  private scheduleCleanup(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    this.cleanupTimer = setTimeout(async () => {
      const idleTime = Date.now() - this.lastUsed;
      if (idleTime >= this.IDLE_TIMEOUT) {
        console.log("[BrowserManager] Closing idle browser instance...");
        await this.close();
      }
    }, this.IDLE_TIMEOUT);
  }

  /**
   * Close browser and context
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    console.log("[BrowserManager] Browser closed");
  }

  /**
   * Force close and reset (for testing or errors)
   */
  async reset(): Promise<void> {
    console.log("[BrowserManager] Resetting browser...");
    await this.close();
  }
}

export default BrowserManager;
