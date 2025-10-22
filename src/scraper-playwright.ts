import * as cheerio from 'cheerio';
import YAML from 'yaml';
import { chromium } from 'playwright-core';

export interface RawDataItem {
  label?: string;
  value: string;
  type?: 'text' | 'link' | 'image' | 'price' | 'table';
  attributes?: Record<string, string>;
}

export interface ScrapingStats {
  totalItems: number;
  itemsByType: {
    table: number;
    text: number;
    image: number;
    price: number;
  };
  estimatedTokens: number;
  scrapingTimeMs: number;
}

export interface RawPageContent {
  url: string;
  title: string;
  data: RawDataItem[];
  stats?: ScrapingStats;
  yaml?: string;
}

/**
 * Estimate token count using a simple heuristic (approximately 4 chars per token)
 */
function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // For YAML/structured data, we use a slightly different ratio
  return Math.ceil(text.length / 3.5);
}

/**
 * Calculate statistics for scraped data
 */
function calculateStats(data: RawDataItem[], scrapingTimeMs: number): ScrapingStats {
  const stats: ScrapingStats = {
    totalItems: data.length,
    itemsByType: {
      table: 0,
      text: 0,
      image: 0,
      price: 0
    },
    estimatedTokens: 0,
    scrapingTimeMs
  };

  // Count items by type and estimate tokens
  let totalText = '';
  data.forEach(item => {
    const type = item.type || 'text';
    if (type === 'table') stats.itemsByType.table++;
    else if (type === 'text') stats.itemsByType.text++;
    else if (type === 'image') stats.itemsByType.image++;
    else if (type === 'price') stats.itemsByType.price++;

    // Accumulate text for token estimation
    totalText += (item.label || '') + ' ' + item.value + '\n';
  });

  stats.estimatedTokens = estimateTokenCount(totalText);

  return stats;
}

/**
 * Extract raw data from fully rendered HTML using Cheerio
 */
function extractRawDataFromHtml(html: string, url: string): RawDataItem[] {
  const $ = cheerio.load(html);
  const data: RawDataItem[] = [];
  const seen = new Set<string>();

  const cleanText = (text: string): string => {
    return text.replace(/\s+/g, ' ').trim();
  };

  const addData = (item: RawDataItem) => {
    const key = `${item.label || ''}:${item.value}`;
    if (!seen.has(key) && item.value.length > 0 && item.value.length < 500) {
      seen.add(key);
      data.push(item);
    }
  };

  // Extract from tables
  $('table').each((_, table) => {
    const $table = $(table);
    $table.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();

      if (cells.length === 2) {
        const label = cleanText($(cells[0]).text());
        const value = cleanText($(cells[1]).text());

        if (label && value && label !== value) {
          addData({ label, value, type: 'table' });
        }
      }
    });
  });

  // Extract specifications from common e-commerce patterns
  // Look for attribute/spec rows (div/span patterns with label-value pairs)
  $('[class*="spec"], [class*="attribute"], [class*="feature"], [class*="detail"], [class*="characteristic"], [class*="fiche"]').each((_, el) => {
    const $el = $(el);
    const text = cleanText($el.text());

    // Try to find label-value patterns within
    const children = $el.children().toArray();
    if (children.length === 2) {
      const label = cleanText($(children[0]).text());
      const value = cleanText($(children[1]).text());

      if (label && value && label !== value && label.length < 100 && value.length < 200) {
        addData({ label, value, type: 'table' });
      }
    }
  });

  // Enhanced extraction for Orange-style specifications and other e-commerce sites
  // Look for any element containing ":" which often indicates label:value patterns
  $('div, span, p, li').each((_, el) => {
    const $el = $(el);
    const text = cleanText($el.text());
    
    // Look for patterns like "Label: Value" or "Label : Value"
    if (text.includes(':') && text.length < 200 && text.split(':').length === 2) {
      const parts = text.split(':');
      const label = cleanText(parts[0]);
      const value = cleanText(parts[1]);
      
      if (label && value && label.length < 100 && value.length < 150) {
        addData({ label, value, type: 'table' });
      }
    }
  });

  // Extract from any table-like structures with more flexibility
  $('tr, .row, [class*="line"], [class*="item"]').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td, th, div, span').toArray();
    
    // Look for any two-column structure
    if (cells.length >= 2) {
      for (let i = 0; i < cells.length - 1; i += 2) {
        const label = cleanText($(cells[i]).text());
        const value = cleanText($(cells[i + 1]).text());
        
        if (label && value && label !== value && label.length < 100 && value.length < 200) {
          addData({ label, value, type: 'table' });
        }
      }
    }
  });

  // Extract from definition lists
  $('dl').each((_, dl) => {
    const $dl = $(dl);
    $dl.find('dt').each((i, dt) => {
      const label = cleanText($(dt).text());
      const dd = $(dt).next('dd');
      const value = cleanText(dd.text());

      if (label && value) {
        addData({ label, value, type: 'text' });
      }
    });
  });

  // Extract headings
  $('h1, h2, h3, h4').each((_, heading) => {
    const $heading = $(heading);
    const headingText = cleanText($heading.text());

    if (headingText) {
      addData({ value: headingText, type: 'text' });
    }
  });

  // Extract prices
  $('[class*="price"], [class*="amount"], [data-price]').each((_, el) => {
    const $el = $(el);
    const text = cleanText($el.text());

    if (text && text.match(/\d+[\s.,]?\d*\s*[€$]/)) {
      const label = $el.attr('aria-label') || $el.attr('title') || 'Price';
      addData({ label, value: text, type: 'price' });
    }
  });

  // Extract merchant information
  $('[class*="retailer"], [class*="merchant"], [class*="store"], [class*="shop"]').each((_, el) => {
    const $el = $(el);
    const merchantName = cleanText($el.find('[class*="name"], h3, h4, strong, span').first().text());
    const priceEl = $el.find('[class*="price"], [class*="amount"]').first();
    const price = cleanText(priceEl.text());
    const availability = cleanText($el.find('[class*="stock"], [class*="availability"], [class*="rupture"]').text());
    const shipping = cleanText($el.find('[class*="shipping"], [class*="delivery"], [class*="livraison"]').text());

    if (merchantName) {
      addData({ label: 'Merchant', value: merchantName, type: 'text' });
      if (price) addData({ label: `${merchantName} - Price`, value: price, type: 'price' });
      if (availability) addData({ label: `${merchantName} - Availability`, value: availability, type: 'text' });
      if (shipping) addData({ label: `${merchantName} - Shipping`, value: shipping, type: 'text' });
    }
  });

  // Skip link extraction - only images are needed
  // Links (<a href>) are not extracted to reduce noise in output

  // Extract all images
  $('img[src], img[data-src]').each((_, img) => {
    const $img = $(img);
    let src = $img.attr('src') || $img.attr('data-src') || '';
    const alt = $img.attr('alt') || '';

    if (src) {
      if (src.startsWith('/')) {
        const urlObj = new URL(url);
        src = `${urlObj.protocol}//${urlObj.host}${src}`;
      }

      addData({
        label: alt || 'Image',
        value: src,
        type: 'image'
      });
    }
  });

  // Extract list items
  $('ul > li, ol > li').each((_, li) => {
    const $li = $(li);
    const text = cleanText($li.clone().children().remove().end().text());

    if (text) {
      addData({ value: text, type: 'text' });
    }
  });

  // Extract paragraphs
  $('p').each((_, p) => {
    const text = cleanText($(p).text());
    if (text && text.length > 10) {
      addData({ value: text, type: 'text' });
    }
  });

  return data;
}

/**
 * Scrape page using Playwright to get fully rendered HTML, then parse with Cheerio
 */
export async function scrapePageWithPlaywright(url: string, options: { flatten?: boolean; format?: 'json' | 'yaml' } = {}): Promise<RawPageContent> {
  const { flatten = true, format = 'yaml' } = options;

  const startTime = Date.now();
  let browser;
  try {
    // Launch browser with anti-detection techniques
    const isHeadless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
    console.log(`Launching browser in ${isHeadless ? 'HEADLESS' : 'HEADED'} mode with stealth techniques`);
    
    browser = await chromium.launch({
      headless: isHeadless,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        // Anti-detection flags
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--disable-dev-shm-usage',
        '--disable-ipc-flooding-protection',
        // Realistic window size
        '--window-size=1920,1080',
        '--start-maximized',
        // Additional stealth
        '--no-first-run',
        '--disable-default-apps',
        '--disable-extensions-file-access-check',
        '--disable-extensions-http-throttling'
      ]
    });

    const context = await browser.newContext({
      // Randomized realistic user agent
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      javaScriptEnabled: true,
      // Realistic viewport
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      // Additional realism
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      geolocation: { latitude: 48.8566, longitude: 2.3522 }, // Paris
      permissions: ['geolocation'],
      // Accept downloads and popups
      acceptDownloads: true,
      // Extra headers to look more human
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const page = await context.newPage();

    // Anti-detection scripts - mask automation fingerprints
    await page.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['fr-FR', 'fr', 'en'],
      });

      // Mock screen properties to match viewport
      Object.defineProperty(screen, 'width', {
        get: () => 1920,
      });
      Object.defineProperty(screen, 'height', {
        get: () => 1080,
      });
      Object.defineProperty(screen, 'availWidth', {
        get: () => 1920,
      });
      Object.defineProperty(screen, 'availHeight', {
        get: () => 1040,
      });

      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as any) :
          originalQuery(parameters)
      );

      // Mock chrome object
      (window as any).chrome = {
        runtime: {},
      };
    });

    // Navigate with intelligent waiting
    console.log('Navigating to page with anti-detection...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for multiple load states intelligently
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.waitForLoadState('load'),
      page.waitForLoadState('domcontentloaded')
    ]);

    // Monitor network activity for critical resources
    const responses = [];
    page.on('response', response => {
      if (response.url().includes('api') || response.url().includes('json') || response.url().includes('ajax')) {
        responses.push(response.url());
      }
    });

    // Verify JavaScript is working and check page state
    const jsCheck = await page.evaluate(() => {
      return {
        hasJavaScript: typeof window !== 'undefined',
        documentReady: document.readyState,
        bodyHeight: document.body.scrollHeight,
        title: document.title,
        scriptsCount: document.scripts.length,
        // Check for headless detection
        isHeadlessDetected: navigator.webdriver || 
                            !navigator.plugins.length || 
                            !navigator.languages.length,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio
        }
      };
    });
    
    console.log('JavaScript check:', jsCheck);

    // Wait for initial page load and dynamic content
    await page.waitForTimeout(5000); // Initial wait
    
    // Wait additional time for post-TTFB resources as observed in waterfall
    console.log('Waiting additional 10s for post-TTFB resources to load...');
    await page.waitForTimeout(10000); // Additional 10s wait for waterfall resources
    
    // Wait for network to be completely idle again after the additional resources
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      console.log('Network idle achieved after additional wait');
    } catch (err) {
      console.log('Network still active after additional wait, proceeding anyway');
    }

    // Wait for potential dynamic content to load
    try {
      await page.waitForFunction(() => {
        // Wait for any element that might contain specifications
        const specs = document.querySelectorAll('[class*="spec"], [class*="fiche"], [class*="characteristic"], [class*="detail"]');
        return specs.length > 0;
      }, { timeout: 10000 });
      console.log('Specification elements found');
    } catch (err) {
      console.log('No specification elements found within timeout');
    }

    // Human-like progressive scrolling with mouse simulation
    console.log('Starting human-like scrolling and interactions...');
    
    // Get page dimensions first
    const pageInfo = await page.evaluate(() => ({
      height: document.body.scrollHeight,
      viewportHeight: window.innerHeight
    }));
    
    console.log(`Page height: ${pageInfo.height}, Viewport: ${pageInfo.viewportHeight}`);
    
    // Simulate human mouse movement and scrolling
    const scrollStep = 300;
    const humanDelayMin = 200;
    const humanDelayMax = 500;
    
    // Function to get random delay
    const randomDelay = () => Math.floor(Math.random() * (humanDelayMax - humanDelayMin + 1)) + humanDelayMin;
    
    // Scroll down progressively with mouse movements
    for (let currentY = 0; currentY < pageInfo.height; currentY += scrollStep) {
      // Simulate mouse movement before scroll
      await page.mouse.move(
        Math.random() * 1920, 
        Math.random() * 1080
      );
      
      // Scroll to position
      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'smooth' });
      }, currentY);
      
      // Human-like delay
      await page.waitForTimeout(randomDelay());
      
      // Check if new content appeared
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight > pageInfo.height) {
        pageInfo.height = newHeight;
        console.log(`Content expanded to ${newHeight}px`);
      }
    }
    
    // Stay at bottom briefly
    await page.waitForTimeout(1000);
    
    // Scroll back to top smoothly
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    await page.waitForTimeout(1000);
    console.log('Human-like scrolling completed');

    // Wait a bit more
    await page.waitForTimeout(1000);

    // Try to expand any collapsible sections by clicking on them
    try {
      // Look for buttons or elements that might expand specification sections
      const expandableSelectors = [
        'button[aria-expanded="false"]',
        '[class*="collaps"]',
        '[class*="expand"]', 
        '[class*="accord"]',
        '[class*="toggle"]',
        '[data-testid*="expand"]',
        '[role="button"]',
        // Orange specific selectors
        '[class*="fiche"]',
        '[class*="characteristic"]',
        '[class*="detail"]'
      ];

      for (const selector of expandableSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          try {
            // Check if element is visible and clickable
            if (await element.isVisible()) {
              await element.click({ timeout: 1000 });
              await page.waitForTimeout(500); // Wait for content to load
            }
          } catch (err) {
            // Continue if clicking fails
          }
        }
      }

      // Wait for any newly loaded content
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log('Could not expand sections:', err instanceof Error ? err.message : String(err));
    }

    // Take a screenshot for debugging (optional)
    if (process.env.PLAYWRIGHT_DEBUG_SCREENSHOTS === 'true') {
      await page.screenshot({ 
        path: `debug-${Date.now()}.png`, 
        fullPage: true 
      });
      console.log('Debug screenshot saved');
    }

    // Log network responses captured
    console.log(`Captured ${responses.length} API/JSON responses during page load`);
    
    // Final page state check
    const finalState = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      elements: document.querySelectorAll('*').length,
      scripts: document.scripts.length,
      title: document.title
    }));
    
    console.log('Final page state:', finalState);

    // Get the fully rendered HTML
    const html = await page.content();

    // Close browser
    await browser.close();

    const $ = cheerio.load(html);

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

    // Extract raw data from the rendered HTML
    const data = extractRawDataFromHtml(html, url);

    // Calculate statistics
    const scrapingTimeMs = Date.now() - startTime;
    const stats = calculateStats(data, scrapingTimeMs);

    // Convert to YAML if requested (excluding stats from YAML output)
    const yaml = format === 'yaml' ? YAML.stringify(data) : undefined;

    return {
      url,
      title,
      data,
      stats,
      yaml
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return {
      url,
      title: 'Error',
      data: [{
        label: 'Error',
        value: error instanceof Error ? error.message : 'Unknown error',
        type: 'text'
      }]
    };
  }
}

/**
 * Scrape multiple pages using Playwright
 */
export async function scrapeMultiplePagesWithPlaywright(urls: string[], options: { flatten?: boolean; format?: 'json' | 'yaml' } = {}): Promise<RawPageContent[]> {
  const promises = urls.map(url => scrapePageWithPlaywright(url, options));
  return Promise.all(promises);
}

/**
 * Take a screenshot of a webpage using Playwright
 */
export async function takeScreenshotWithPlaywright(
  url: string, 
  options: { 
    width?: number; 
    height?: number; 
    fullPage?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
  } = {}
): Promise<{ 
  url: string; 
  title: string; 
  screenshot: Buffer; 
  format: string;
  dimensions: { width: number; height: number };
  timestamp: string;
}> {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  
  const context = await browser.newContext({
    viewport: { 
      width: options.width || 1920, 
      height: options.height || 1080 
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    console.log(`Taking screenshot of: ${url}`);
    
    // Navigate to page
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Wait for page to be fully loaded
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Wait 3 seconds for dynamic content

    // Get page title
    const title = await page.title();

    // Take screenshot
    const screenshotOptions: any = {
      fullPage: options.fullPage || false,
      type: options.format || 'png'
    };

    if (options.format === 'jpeg' && options.quality) {
      screenshotOptions.quality = options.quality;
    }

    const screenshot = await page.screenshot(screenshotOptions);

    // Get actual dimensions
    const viewport = page.viewportSize();
    const dimensions = {
      width: viewport?.width || options.width || 1920,
      height: viewport?.height || options.height || 1080
    };

    return {
      url,
      title,
      screenshot,
      format: options.format || 'png',
      dimensions,
      timestamp: new Date().toISOString()
    };

  } finally {
    await context.close();
    await browser.close();
  }
}
