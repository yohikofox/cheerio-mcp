import { chromium } from 'playwright-core';
import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface SearchEngineResult {
  engine: string;
  query: string;
  results: SearchResult[];
  totalResults: number;
  searchTimeMs: number;
}

/**
 * Random delay to simulate human behavior
 */
function randomDelay(min: number = 500, max: number = 2000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Search Google with stealth mode and human-like behavior
 */
export async function searchGoogleStealth(query: string, maxResults: number = 10): Promise<SearchEngineResult> {
  const startTime = Date.now();
  let browser;

  try {
    // Launch with stealth settings
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'fr-FR',
      viewport: { width: 1920, height: 1080 },
      // Accept language
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      }
    });

    const page = await context.newPage();

    // Override navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });

    // First, visit Google homepage to get cookies
    await page.goto('https://www.google.com', { waitUntil: 'networkidle', timeout: 20000 });

    // Random delay like a human
    await randomDelay(1000, 2000);

    // Try to accept cookies if popup appears
    try {
      const acceptButton = page.locator('button:has-text("Tout accepter"), button:has-text("Accept all"), button:has-text("J\'accepte")').first();
      if (await acceptButton.isVisible({ timeout: 3000 })) {
        await acceptButton.click();
        await randomDelay(500, 1000);
      }
    } catch (e) {
      // No cookie popup, continue
    }

    // Now perform the search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=${Math.min(maxResults * 2, 100)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Random human-like delay
    await randomDelay(800, 1500);

    // Scroll like a human
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 500 + 300);
    });
    await randomDelay(300, 700);

    // Wait for results with fallback
    try {
      await page.waitForSelector('#search, #rso, .g', { timeout: 5000 });
    } catch (e) {
      // Continue anyway, might still have results
    }

    // Get the HTML
    const html = await page.content();
    await browser.close();

    // Check if we got CAPTCHA
    if (html.includes('g-recaptcha') || html.includes('captcha')) {
      console.error('Google CAPTCHA detected despite stealth mode');
      return {
        engine: 'google-stealth',
        query,
        results: [],
        totalResults: 0,
        searchTimeMs: Date.now() - startTime
      };
    }

    // Parse results with Cheerio
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Try multiple selectors for Google results
    const selectors = [
      '.g:has(a[href])',
      'div.g',
      '[data-sokoban-container]',
      '.Gx5Zad'
    ];

    for (const selector of selectors) {
      if (results.length >= maxResults) break;

      $(selector).each((index, element) => {
        if (results.length >= maxResults) return;

        const $element = $(element);

        // Extract title
        const $title = $element.find('h3, [role="heading"]').first();
        const title = $title.text().trim();

        // Extract URL
        const $link = $element.find('a[href^="http"], a[href^="/url"]').first();
        let url = $link.attr('href') || '';

        // Clean URL (remove Google redirect)
        if (url.startsWith('/url?q=')) {
          const urlMatch = url.match(/\/url\?q=([^&]+)/);
          if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
          }
        }

        // Extract snippet
        let snippet = '';
        const snippetSelectors = [
          '[data-snf]',
          '.VwiC3b',
          '.lyLwlc',
          '[data-content-feature]',
          '.s'
        ];

        for (const snipSelector of snippetSelectors) {
          const $snippet = $element.find(snipSelector).first();
          if ($snippet.length) {
            snippet = $snippet.text().trim();
            break;
          }
        }

        // Fallback: get text and clean
        if (!snippet) {
          snippet = $element.text().replace(title, '').trim().substring(0, 300);
        }

        // Only add if we have valid data
        if (title && url && url.startsWith('http') && !url.includes('google.com/search')) {
          // Check for duplicates
          const isDuplicate = results.some(r => r.url === url);
          if (!isDuplicate) {
            results.push({
              title,
              url,
              snippet,
              position: results.length + 1
            });
          }
        }
      });
    }

    const searchTimeMs = Date.now() - startTime;

    return {
      engine: 'google-stealth',
      query,
      results,
      totalResults: results.length,
      searchTimeMs
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    console.error('Google search error:', error instanceof Error ? error.message : 'Unknown error');

    return {
      engine: 'google-stealth',
      query,
      results: [],
      totalResults: 0,
      searchTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Search Google using Custom Search API (requires API key)
 */
export async function searchGoogleAPI(
  query: string,
  apiKey: string,
  searchEngineId: string,
  maxResults: number = 10
): Promise<SearchEngineResult> {
  const startTime = Date.now();

  try {
    const fetch = (await import('node-fetch')).default;

    // Google Custom Search API endpoint
    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    const results: SearchResult[] = [];

    if (data.items && Array.isArray(data.items)) {
      data.items.forEach((item: any, index: number) => {
        results.push({
          title: item.title || '',
          url: item.link || '',
          snippet: item.snippet || '',
          position: index + 1
        });
      });
    }

    return {
      engine: 'google-api',
      query,
      results,
      totalResults: results.length,
      searchTimeMs: Date.now() - startTime
    };
  } catch (error) {
    console.error('Google API search error:', error instanceof Error ? error.message : 'Unknown error');

    return {
      engine: 'google-api',
      query,
      results: [],
      totalResults: 0,
      searchTimeMs: Date.now() - startTime
    };
  }
}
