import * as cheerio from 'cheerio';
import YAML from 'yaml';
import { chromium, Page } from 'playwright-core';
import BrowserManager from './browser-manager.js';
import { loadDomainConfig, DomainConfig } from './domain-config-manager.js';

/**
 * Log with timestamp for temporal tracking
 */
function logWithTime(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * Generate random delay between min and max (inclusive) to avoid bot-like behavior
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
export function estimateTokenCount(text: string): number {
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
 * Check if an element should be filtered out (generic noise detection)
 */
function shouldFilterElement($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): boolean {
  // 1. Structural zones to exclude
  const tagName = $el.prop('tagName')?.toLowerCase();
  if (['header', 'footer', 'nav', 'aside'].includes(tagName || '')) {
    return true;
  }

  // 2. Check if element is within excluded zones
  if ($el.closest('header, footer, nav, aside').length > 0) {
    return true;
  }

  // 3. Role-based exclusion
  const role = $el.attr('role');
  if (role && ['navigation', 'banner', 'contentinfo', 'complementary'].includes(role)) {
    return true;
  }

  // 4. Class/ID patterns indicating UI/navigation elements
  const classAttr = $el.attr('class') || '';
  const idAttr = $el.attr('id') || '';
  const combinedAttrs = `${classAttr} ${idAttr}`.toLowerCase();

  const noisePatterns = [
    'nav', 'navigation', 'menu', 'breadcrumb', 'footer', 'header',
    'sidebar', 'aside', 'modal', 'popup', 'cookie', 'banner',
    'advertisement', 'promo', 'newsletter', 'social', 'share',
    'login', 'signup', 'search-bar', 'toolbar', 'sticky'
  ];

  if (noisePatterns.some(pattern => combinedAttrs.includes(pattern))) {
    return true;
  }

  // 5. Hidden elements
  const style = $el.attr('style') || '';
  if (style.includes('display:none') || style.includes('display: none') ||
      style.includes('visibility:hidden') || style.includes('visibility: hidden')) {
    return true;
  }

  const ariaHidden = $el.attr('aria-hidden');
  if (ariaHidden === 'true') {
    return true;
  }

  // 6. Product suggestions/recommendations (not the main product)
  if (classAttr.includes('product-mini-card') ||
      classAttr.includes('recommendation') ||
      classAttr.includes('suggestion')) {
    return true;
  }

  return false;
}

/**
 * Check if text content is likely noise
 */
function isNoiseText(text: string): boolean {
  if (!text || text.length < 3) return true;

  const lowerText = text.toLowerCase().trim();

  // Common noise phrases in French/English
  const noisePhrases = [
    'cookie', 'en savoir plus', 'accepter', 'refuser',
    'mentions légales', 'cgv', 'cgu', 'confidentialité',
    'téléchargez l\'app', 'télécharger l\'app', 'download app',
    'besoin d\'aide', 'contactez', 'service client',
    'suivez-nous', 'réseaux sociaux', 'newsletter',
    'mon compte', 'se connecter', 'connexion', 'panier',
    'retour', 'précédent', 'suivant', 'fermer', 'ouvrir',
    'en stock', 'rupture', 'disponible', 'indisponible'
  ];

  // Exact match for short phrases
  if (lowerText.length < 50) {
    for (const phrase of noisePhrases) {
      if (lowerText === phrase || lowerText.includes(phrase)) {
        return true;
      }
    }
  }

  // Filter out pure navigation text
  if (lowerText.match(/^(>|<|«|»|\||\/)+$/)) {
    return true;
  }

  return false;
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
    if (!seen.has(key) && item.value.length > 0 && item.value.length < 500 && !isNoiseText(item.value)) {
      seen.add(key);
      data.push(item);
    }
  };

  // Extract from tables
  $('table').each((_, table) => {
    const $table = $(table);

    // Skip if table is in filtered zone
    if (shouldFilterElement($table, $)) return;

    $table.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();

      if (cells.length === 2) {
        const label = cleanText($(cells[0]).text());
        const value = cleanText($(cells[1]).text());

        if (label && value && label !== value && !isNoiseText(label) && !isNoiseText(value)) {
          addData({ label, value, type: 'table' });
        }
      }
    });
  });

  // Extract specifications from common e-commerce patterns
  // Look for attribute/spec rows (div/span patterns with label-value pairs)
  $('[class*="spec"], [class*="attribute"], [class*="feature"], [class*="detail"], [class*="characteristic"], [class*="fiche"]').each((_, el) => {
    const $el = $(el);

    // Skip if element is in filtered zone
    if (shouldFilterElement($el, $)) return;

    const text = cleanText($el.text());

    // Try to find label-value patterns within
    const children = $el.children().toArray();
    if (children.length === 2) {
      const label = cleanText($(children[0]).text());
      const value = cleanText($(children[1]).text());

      if (label && value && label !== value && label.length < 100 && value.length < 200 &&
          !isNoiseText(label) && !isNoiseText(value)) {
        addData({ label, value, type: 'table' });
      }
    }
  });

  // Enhanced extraction for Orange-style specifications and other e-commerce sites
  // Look for any element containing ":" which often indicates label:value patterns
  $('div, span, p, li').each((_, el) => {
    const $el = $(el);

    // Skip if element is in filtered zone
    if (shouldFilterElement($el, $)) return;

    const text = cleanText($el.text());

    // Look for patterns like "Label: Value" or "Label : Value"
    if (text.includes(':') && text.length < 200 && text.split(':').length === 2) {
      const parts = text.split(':');
      const label = cleanText(parts[0]);
      const value = cleanText(parts[1]);

      if (label && value && label.length < 100 && value.length < 150 &&
          !isNoiseText(label) && !isNoiseText(value)) {
        addData({ label, value, type: 'table' });
      }
    }
  });

  // Extract from any table-like structures with more flexibility
  $('tr, .row, [class*="line"], [class*="item"]').each((_, row) => {
    const $row = $(row);

    // Skip if row is in filtered zone
    if (shouldFilterElement($row, $)) return;

    const cells = $row.find('td, th, div, span').toArray();

    // Look for any two-column structure
    if (cells.length >= 2) {
      for (let i = 0; i < cells.length - 1; i += 2) {
        const label = cleanText($(cells[i]).text());
        const value = cleanText($(cells[i + 1]).text());

        if (label && value && label !== value && label.length < 100 && value.length < 200 &&
            !isNoiseText(label) && !isNoiseText(value)) {
          addData({ label, value, type: 'table' });
        }
      }
    }
  });

  // Extract from definition lists
  $('dl').each((_, dl) => {
    const $dl = $(dl);

    // Skip if definition list is in filtered zone
    if (shouldFilterElement($dl, $)) return;

    $dl.find('dt').each((i, dt) => {
      const label = cleanText($(dt).text());
      const dd = $(dt).next('dd');
      const value = cleanText(dd.text());

      if (label && value && !isNoiseText(label) && !isNoiseText(value)) {
        addData({ label, value, type: 'text' });
      }
    });
  });

  // Extract headings (focus on main content area)
  $('main h1, main h2, main h3, main h4, [role="main"] h1, [role="main"] h2, [role="main"] h3, [role="main"] h4, article h1, article h2, article h3, article h4').each((_, heading) => {
    const $heading = $(heading);

    // Skip if heading is in filtered zone
    if (shouldFilterElement($heading, $)) return;

    const headingText = cleanText($heading.text());

    if (headingText && !isNoiseText(headingText)) {
      addData({ value: headingText, type: 'text' });
    }
  });

  // Extract prices
  $('[class*="price"], [class*="amount"], [data-price]').each((_, el) => {
    const $el = $(el);

    // Skip if price is in filtered zone
    if (shouldFilterElement($el, $)) return;

    const text = cleanText($el.text());

    if (text && text.match(/\d+[\s.,]?\d*\s*[€$]/) && !isNoiseText(text)) {
      const label = $el.attr('aria-label') || $el.attr('title') || 'Price';
      addData({ label, value: text, type: 'price' });
    }
  });

  // Extract merchant information
  $('[class*="retailer"], [class*="merchant"], [class*="store"], [class*="shop"]').each((_, el) => {
    const $el = $(el);

    // Skip if merchant is in filtered zone
    if (shouldFilterElement($el, $)) return;

    const merchantName = cleanText($el.find('[class*="name"], h3, h4, strong, span').first().text());
    const priceEl = $el.find('[class*="price"], [class*="amount"]').first();
    const price = cleanText(priceEl.text());
    const availability = cleanText($el.find('[class*="stock"], [class*="availability"], [class*="rupture"]').text());
    const shipping = cleanText($el.find('[class*="shipping"], [class*="delivery"], [class*="livraison"]').text());

    if (merchantName && !isNoiseText(merchantName)) {
      addData({ label: 'Merchant', value: merchantName, type: 'text' });
      if (price && !isNoiseText(price)) addData({ label: `${merchantName} - Price`, value: price, type: 'price' });
      if (availability && !isNoiseText(availability)) addData({ label: `${merchantName} - Availability`, value: availability, type: 'text' });
      if (shipping && !isNoiseText(shipping)) addData({ label: `${merchantName} - Shipping`, value: shipping, type: 'text' });
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

  // Extract list items (only from main content)
  $('main ul > li, main ol > li, [role="main"] ul > li, [role="main"] ol > li, article ul > li, article ol > li').each((_, li) => {
    const $li = $(li);

    // Skip if list item is in filtered zone
    if (shouldFilterElement($li, $)) return;

    const text = cleanText($li.clone().children().remove().end().text());

    if (text && !isNoiseText(text)) {
      addData({ value: text, type: 'text' });
    }
  });

  // Extract paragraphs (only from main content)
  $('main p, [role="main"] p, article p').each((_, p) => {
    const $p = $(p);

    // Skip if paragraph is in filtered zone
    if (shouldFilterElement($p, $)) return;

    const text = cleanText($p.text());
    if (text && text.length > 10 && !isNoiseText(text)) {
      addData({ value: text, type: 'text' });
    }
  });

  return data;
}

/**
 * Extract data using domain configuration as guide
 */
function extractDataWithDomainConfig(html: string, url: string, config: DomainConfig): RawDataItem[] {
  const $ = cheerio.load(html);
  const data: RawDataItem[] = [];
  const seen = new Set<string>();

  const addData = (item: RawDataItem) => {
    const key = `${item.label || ''}:${item.value}`;
    if (!seen.has(key) && item.value && item.value.length > 0) {
      seen.add(key);
      data.push(item);
    }
  };

  logWithTime(`[Config-Guided Extraction] Strategy: ${config.extractionStrategy}`);

  // Strategy 1: Extract structured data (JSON-LD, microdata, etc.)
  if (config.extractionStrategy === 'structured' || config.extractionStrategy === 'hybrid') {
    logWithTime(`[Config-Guided Extraction] Extracting structured data...`);

    config.structuredData.forEach((structuredInfo) => {
      const { selector, format, type, data: configData } = structuredInfo;

      if (format === 'json-ld') {
        // Extract JSON-LD data
        $(selector).each((_, script) => {
          try {
            const jsonText = $(script).html();
            if (jsonText) {
              const jsonData = JSON.parse(jsonText);

              // If this is the expected type from config, extract specified fields
              if (jsonData['@type'] === type || (Array.isArray(jsonData) && jsonData.some((item: any) => item['@type'] === type))) {
                const targetData = Array.isArray(jsonData)
                  ? jsonData.find((item: any) => item['@type'] === type)
                  : jsonData;

                if (targetData && configData) {
                  // Get list of fields to extract from config
                  const fieldsToExtract = Object.keys(configData).filter(key => !key.startsWith('@'));

                  logWithTime(`[Config-Guided Extraction] Extracting ${fieldsToExtract.length} fields: ${fieldsToExtract.join(', ')}`);

                  // Extract ONLY the fields specified in config
                  fieldsToExtract.forEach((key) => {
                    if (!targetData.hasOwnProperty(key)) {
                      logWithTime(`[Config-Guided Extraction] Warning: Field '${key}' not found in JSON-LD`);
                      return;
                    }

                    const value = targetData[key];
                    let stringValue: string;

                    if (typeof value === 'object' && value !== null) {
                      // Handle nested objects (e.g., brand.name)
                      stringValue = JSON.stringify(value, null, 2);
                    } else {
                      stringValue = String(value);
                    }

                    addData({
                      label: `${type}.${key}`,
                      value: stringValue,
                      type: 'text',
                      attributes: { source: 'structured-data', format: 'json-ld' }
                    });
                  });
                } else if (targetData && !configData) {
                  // Fallback: if no config.data specified, extract all fields
                  logWithTime(`[Config-Guided Extraction] No field filter in config, extracting all fields`);

                  Object.entries(targetData).forEach(([key, value]) => {
                    if (key.startsWith('@')) return; // Skip @context, @type, etc.

                    let stringValue: string;
                    if (typeof value === 'object' && value !== null) {
                      stringValue = JSON.stringify(value, null, 2);
                    } else {
                      stringValue = String(value);
                    }

                    addData({
                      label: `${type}.${key}`,
                      value: stringValue,
                      type: 'text',
                      attributes: { source: 'structured-data', format: 'json-ld' }
                    });
                  });
                }
              }
            }
          } catch (err) {
            logWithTime(`[Config-Guided Extraction] Failed to parse JSON-LD: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }
    });
  }

  // Strategy 2: Extract using CSS selectors from productInfo
  if (config.extractionStrategy === 'selectors' ||
      (config.extractionStrategy === 'hybrid' && data.length === 0)) {
    logWithTime(`[Config-Guided Extraction] Extracting using CSS selectors...`);

    // Extract each field defined in productInfo
    Object.entries(config.productInfo).forEach(([fieldName, selectorMatches]) => {
      if (!selectorMatches || selectorMatches.length === 0) return;

      // Use the first (highest confidence) selector
      const selectorMatch = selectorMatches[0];
      const { selector } = selectorMatch;

      $(selector).each((i, el) => {
        // Limit to first 3 matches per selector to avoid duplicates
        if (i >= 3) return;

        const $el = $(el);
        let value: string;

        // Special handling based on field type
        if (fieldName === 'images') {
          value = $el.attr('src') || $el.attr('data-src') || '';
        } else {
          value = $el.text().trim();
        }

        if (value) {
          addData({
            label: fieldName,
            value: value,
            type: fieldName === 'images' ? 'image' : fieldName === 'price' ? 'price' : 'text',
            attributes: { source: 'css-selector', selector: selector }
          });
        }
      });
    });
  }

  logWithTime(`[Config-Guided Extraction] Extracted ${data.length} items`);
  return data;
}

/**
 * Scrape page using Playwright to get fully rendered HTML, then parse with Cheerio
 */
export async function scrapePageWithPlaywright(url: string, options: { flatten?: boolean; format?: 'json' | 'yaml' } = {}): Promise<RawPageContent> {
  const { flatten = true, format = 'yaml' } = options;

  const startTime = Date.now();
  let page: Page | undefined;

  try {
    // Use BrowserManager for browser reuse (massive performance gain)
    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();

    logWithTime('Creating new page in reused browser context...');
    page = await context.newPage();

    if (!page) {
      throw new Error('Failed to create page');
    }

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
    logWithTime('Navigating to page with anti-detection...');
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
    
    logWithTime('JavaScript check:', jsCheck);

    // Wait for initial page load and dynamic content (RANDOMIZED 1-2s to avoid bot detection)
    await page.waitForTimeout(randomDelay(1000, 2000));

    // Wait additional time for post-TTFB resources (RANDOMIZED 1.5-2.5s to avoid bot detection)
    logWithTime('Waiting for post-TTFB resources to load...');
    await page.waitForTimeout(randomDelay(1500, 2500));

    // Wait for network to be completely idle again (OPTIMIZED - reduced timeout from 15s to 5s)
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      logWithTime('Network idle achieved');
    } catch (err) {
      logWithTime('Network still active, proceeding anyway');
    }

    // Wait for potential dynamic content to load (OPTIMIZED - reduced from 10s to 3s)
    try {
      await page.waitForFunction(() => {
        // Wait for any element that might contain specifications
        const specs = document.querySelectorAll('[class*="spec"], [class*="fiche"], [class*="characteristic"], [class*="detail"]');
        return specs.length > 0;
      }, { timeout: 3000 });
      logWithTime('Specification elements found');
    } catch (err) {
      logWithTime('No specification elements found within timeout');
    }

    // Human-like progressive scrolling with mouse simulation
    logWithTime('Starting human-like scrolling and interactions...');
    
    // Get page dimensions first
    const pageInfo = await page.evaluate(() => ({
      height: document.body.scrollHeight,
      viewportHeight: window.innerHeight
    }));
    
    logWithTime(`Page height: ${pageInfo.height}, Viewport: ${pageInfo.viewportHeight}`);
    
    // Simulate human mouse movement and scrolling (RANDOMIZED to avoid bot detection)
    const scrollStepMin = 400;
    const scrollStepMax = 600;
    
    // Scroll down progressively with mouse movements
    let currentY = 0;
    while (currentY < pageInfo.height) {
      // Random scroll step to avoid predictable pattern
      const step = randomDelay(scrollStepMin, scrollStepMax);
      currentY += step;

      // Simulate mouse movement before scroll (randomized position)
      await page.mouse.move(
        randomDelay(100, 1820),
        randomDelay(100, 980)
      );

      // Scroll to position
      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'smooth' });
      }, currentY);

      // Human-like delay (randomized between 50-150ms)
      await page.waitForTimeout(randomDelay(50, 150));
      
      // Check if new content appeared
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight > pageInfo.height) {
        pageInfo.height = newHeight;
        logWithTime(`Content expanded to ${newHeight}px`);
      }
    }
    
    // Stay at bottom briefly (RANDOMIZED 200-500ms to avoid bot detection)
    await page.waitForTimeout(randomDelay(200, 500));

    // Scroll back to top smoothly
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    await page.waitForTimeout(randomDelay(200, 400)); // RANDOMIZED to avoid bot detection
    logWithTime('Scrolling completed');

    // Try to expand any collapsible sections by clicking on them (with limits to avoid timeout)
    try {
      // Look for buttons or elements that might expand specification sections
      const expandableSelectors = [
        'button[aria-expanded="false"]',
        '[class*="collaps"]',
        '[class*="expand"]',
        '[class*="accord"]',
        '[class*="toggle"]',
        '[data-testid*="expand"]',
        // Orange specific selectors
        '[class*="fiche"]',
        '[class*="characteristic"]',
        '[class*="detail"]'
      ];

      let clickedCount = 0;
      const MAX_CLICKS = 10; // Limit to 10 clicks maximum to avoid timeout
      const SECTION_TIMEOUT = 5000; // Max 5 seconds for this entire section

      const clickPromise = (async () => {
        for (const selector of expandableSelectors) {
          if (clickedCount >= MAX_CLICKS) break;

          const elements = await page.$$(selector);
          for (const element of elements) {
            if (clickedCount >= MAX_CLICKS) break;

            try {
              // Check if element is visible and clickable
              if (await element.isVisible()) {
                await element.click({ timeout: 500 }); // Reduced from 1000ms
                clickedCount++;
                await page.waitForTimeout(randomDelay(100, 200)); // Reduced delay
              }
            } catch (err) {
              // Continue if clicking fails
            }
          }
        }
      })();

      // Wait for clicks with global timeout
      await Promise.race([
        clickPromise,
        new Promise(resolve => setTimeout(resolve, SECTION_TIMEOUT))
      ]);

      logWithTime(`Clicked ${clickedCount} expandable elements`);

      // Wait for any newly loaded content (RANDOMIZED 200-400ms, reduced from 400-700ms)
      await page.waitForTimeout(randomDelay(200, 400));
    } catch (err) {
      logWithTime('Could not expand sections:', err instanceof Error ? err.message : String(err));
    }

    // Take a screenshot for debugging (optional)
    if (process.env.PLAYWRIGHT_DEBUG_SCREENSHOTS === 'true') {
      await page.screenshot({ 
        path: `debug-${Date.now()}.png`, 
        fullPage: true 
      });
      logWithTime('Debug screenshot saved');
    }

    // Log network responses captured
    logWithTime(`Captured ${responses.length} API/JSON responses during page load`);
    
    // Final page state check
    const finalState = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      elements: document.querySelectorAll('*').length,
      scripts: document.scripts.length,
      title: document.title
    }));
    
    logWithTime('Final page state:', finalState);

    // Get the fully rendered HTML (with timeout to avoid hanging)
    let html: string;
    try {
      logWithTime('Extracting HTML content...');
      html = await Promise.race([
        page.content(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('HTML extraction timeout')), 10000)
        )
      ]);
      logWithTime(`HTML extracted: ${Math.round(html.length / 1024)}KB`);
    } catch (error) {
      logWithTime('Failed to extract HTML:', error instanceof Error ? error.message : String(error));
      throw error;
    }

    // Save HTML for debugging (optional, skip if too large to avoid issues)
    if (process.env.SAVE_HTML_DEBUG !== 'false') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_').substring(0, 50);
        const htmlPath = path.join(process.cwd(), 'log', `scraped-${urlHash}.html`);

        // Only save if HTML is reasonable size (< 5MB)
        if (html.length < 5 * 1024 * 1024) {
          await fs.promises.writeFile(htmlPath, html, 'utf-8');
          logWithTime(`HTML saved to: ${htmlPath}`);
        } else {
          logWithTime(`HTML too large (${Math.round(html.length / 1024 / 1024)}MB), skipping save`);
        }
      } catch (err) {
        logWithTime('Failed to save HTML:', err instanceof Error ? err.message : String(err));
        // Continue anyway, saving HTML is not critical
      }
    }

    // Close page (browser is reused via BrowserManager)
    await page.close();

    const $ = cheerio.load(html);

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

    // Try to load domain config to guide extraction
    let data: RawDataItem[];
    try {
      const domainConfig = await loadDomainConfig(url);

      if (domainConfig) {
        logWithTime(`[Scraper] Found domain config for ${domainConfig.domain}, using config-guided extraction`);
        data = extractDataWithDomainConfig(html, url, domainConfig);
      } else {
        logWithTime(`[Scraper] No domain config found, using generic extraction`);
        data = extractRawDataFromHtml(html, url);
      }
    } catch (err) {
      logWithTime(`[Scraper] Error loading domain config: ${err instanceof Error ? err.message : String(err)}, falling back to generic extraction`);
      data = extractRawDataFromHtml(html, url);
    }

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
    // Close page on error (browser is reused via BrowserManager)
    if (page) {
      try {
        await page.close();
      } catch (err) {
        // Ignore close errors
      }
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
    logWithTime(`Taking screenshot of: ${url}`);
    
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
