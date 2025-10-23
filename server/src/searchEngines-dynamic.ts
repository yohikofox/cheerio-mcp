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
 * Search Google using Playwright for better results
 */
export async function searchGoogleDynamic(query: string, maxResults: number = 10): Promise<SearchEngineResult> {
  const startTime = Date.now();
  let browser;

  try {
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
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'fr-FR'
    });

    const page = await context.newPage();

    // Navigate to Google
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=${Math.min(maxResults, 100)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for results to load
    await page.waitForSelector('#search', { timeout: 10000 });

    // Scroll to load more results
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);

    // Get the HTML
    const html = await page.content();
    await browser.close();

    // Parse results with Cheerio
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Google's organic results selector
    $('#search .g, #rso .g').each((index, element) => {
      if (results.length >= maxResults) return;

      const $element = $(element);

      // Extract title
      const $title = $element.find('h3').first();
      const title = $title.text().trim();

      // Extract URL
      const $link = $element.find('a[href]').first();
      let url = $link.attr('href') || '';

      // Clean URL (remove Google redirect)
      if (url.startsWith('/url?q=')) {
        const urlMatch = url.match(/\/url\?q=([^&]+)/);
        if (urlMatch) {
          url = decodeURIComponent(urlMatch[1]);
        }
      }

      // Extract snippet
      const $snippet = $element.find('[data-snf], [data-content-feature], .VwiC3b, .lyLwlc');
      let snippet = $snippet.first().text().trim();

      // Fallback: get all text and clean
      if (!snippet) {
        snippet = $element.text().replace(title, '').trim().substring(0, 300);
      }

      // Only add if we have valid data
      if (title && url && url.startsWith('http') && !url.includes('google.com')) {
        results.push({
          title,
          url,
          snippet,
          position: results.length + 1
        });
      }
    });

    const searchTimeMs = Date.now() - startTime;

    return {
      engine: 'google',
      query,
      results,
      totalResults: results.length,
      searchTimeMs
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return {
      engine: 'google',
      query,
      results: [],
      totalResults: 0,
      searchTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Search DuckDuckGo using Playwright
 */
export async function searchDuckDuckGoDynamic(query: string, maxResults: number = 10): Promise<SearchEngineResult> {
  const startTime = Date.now();
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.result, .results_links_deep').each((index, element) => {
      if (results.length >= maxResults) return;

      const $element = $(element);

      // Extract title
      const $title = $element.find('.result__a, a.result__a');
      const title = $title.text().trim();

      // Extract URL
      let url = $title.attr('href') || '';

      // DuckDuckGo uses redirect URLs - extract real URL
      if (url.startsWith('//duckduckgo.com/l/?')) {
        const urlParams = new URLSearchParams(url.split('?')[1]);
        url = urlParams.get('uddg') || url;
      }

      // Extract snippet
      const snippet = $element.find('.result__snippet, .result__snippet--t').text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({
          title,
          url,
          snippet,
          position: results.length + 1
        });
      }
    });

    return {
      engine: 'duckduckgo',
      query,
      results,
      totalResults: results.length,
      searchTimeMs: Date.now() - startTime
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return {
      engine: 'duckduckgo',
      query,
      results: [],
      totalResults: 0,
      searchTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Search Bing using Playwright
 */
export async function searchBingDynamic(query: string, maxResults: number = 10): Promise<SearchEngineResult> {
  const startTime = Date.now();
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('.b_algo').each((index, element) => {
      if (results.length >= maxResults) return;

      const $element = $(element);

      const title = $element.find('h2 a').text().trim();
      const url = $element.find('h2 a').attr('href') || '';
      const snippet = $element.find('.b_caption p, .b_algoSlug').text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({
          title,
          url,
          snippet,
          position: results.length + 1
        });
      }
    });

    return {
      engine: 'bing',
      query,
      results,
      totalResults: results.length,
      searchTimeMs: Date.now() - startTime
    };
  } catch (error) {
    if (browser) {
      await browser.close();
    }

    return {
      engine: 'bing',
      query,
      results: [],
      totalResults: 0,
      searchTimeMs: Date.now() - startTime
    };
  }
}
