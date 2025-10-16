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
  $('[class*="spec"], [class*="attribute"], [class*="feature"], [class*="detail"]').each((_, el) => {
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
    // Launch headless browser (use system chromium)
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Navigate to the page and wait for network to be idle
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Scroll to the bottom to trigger lazy-loaded content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait for any lazy-loaded content
    await page.waitForTimeout(2000);

    // Scroll back to top and scroll down slowly to trigger all elements
    await page.evaluate(async () => {
      const scrollStep = 500;
      const scrollDelay = 100;

      window.scrollTo(0, 0);
      const totalHeight = document.body.scrollHeight;

      for (let scrolled = 0; scrolled < totalHeight; scrolled += scrollStep) {
        window.scrollTo(0, scrolled);
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
      }
    });

    // Wait a bit more
    await page.waitForTimeout(1000);

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
