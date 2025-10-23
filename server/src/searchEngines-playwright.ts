import * as cheerio from "cheerio";
import { Page } from "playwright-core";
import BrowserManager from "./browser-manager.js";

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
  error?: string;
}

/**
 * Check if URL matches allowed domains
 */
function matchesAllowedDomains(url: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "").toLowerCase();

    return allowedDomains.some((domain) => {
      const cleanDomain = domain.replace("www.", "").toLowerCase();
      return hostname.includes(cleanDomain) || hostname.endsWith(cleanDomain);
    });
  } catch (e) {
    return false;
  }
}

/**
 * Search on Google using Playwright (visible browser)
 */
export async function searchGoogleWithPlaywright(
  query: string,
  maxResults: number = 10,
  allowedDomains?: string[]
): Promise<SearchEngineResult> {
  let page: Page | undefined;

  try {
    console.log(`[Google Search] Searching for: "${query}"`);

    // Use BrowserManager for browser reuse
    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();
    page = await context.newPage();

    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encodedQuery}&num=${maxResults}`;

    console.log(`[Google Search] Navigating to: ${url}`);

    // Navigate to Google search
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for search results to load
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
      console.log("[Google Search] Network idle timeout, continuing anyway");
    });

    // Wait for search results container
    await page.waitForSelector("#search, #rso", { timeout: 10000 }).catch(() => {
      console.log("[Google Search] Search results container not found");
    });

    // Additional wait for dynamic content
    await page.waitForTimeout(2000);

    // Get the HTML
    const html = await page.content();
    console.log(`[Google Search] HTML length: ${html.length} chars`);

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Google organic results selector (excludes ads)
    $(".g, div[data-sokoban-container]").each((_index, element) => {
      if (results.length >= maxResults) return false;

      const $element = $(element);

      // Skip ads (elements with data-text-ad attribute)
      if ($element.find("[data-text-ad]").length > 0) return;

      const $link = $element.find("a[href]").first();
      const linkUrl = $link.attr("href");

      // Skip non-http links and Google internal links
      if (
        !linkUrl ||
        !linkUrl.startsWith("http") ||
        linkUrl.includes("google.com")
      )
        return;

      // Check if URL matches allowed domains
      if (!matchesAllowedDomains(linkUrl, allowedDomains)) return;

      const title = $link.find("h3").text().trim();
      const snippet = $element.find(".VwiC3b, .yXK7lf, .IsZvec").text().trim();

      if (title && linkUrl) {
        results.push({
          title,
          url: linkUrl,
          snippet,
          position: results.length + 1,
        });
      }
    });

    console.log(
      `[Google Search] Found ${results.length} results for "${query}"`
    );

    await page.close();

    return {
      engine: "Google",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    console.error(`[Google Search] Error:`, error);

    if (page) {
      try {
        await page.close();
      } catch (err) {
        // Ignore close errors
      }
    }

    return {
      engine: "Google",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search on DuckDuckGo using Playwright (visible browser)
 */
export async function searchDuckDuckGoWithPlaywright(
  query: string,
  maxResults: number = 10,
  allowedDomains?: string[]
): Promise<SearchEngineResult> {
  let page: Page | undefined;

  try {
    console.log(`[DuckDuckGo Search] Searching for: "${query}"`);

    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();
    page = await context.newPage();

    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    console.log(`[DuckDuckGo Search] Navigating to: ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
      console.log("[DuckDuckGo Search] Network idle timeout, continuing anyway");
    });

    await page.waitForTimeout(2000);

    const html = await page.content();
    console.log(`[DuckDuckGo Search] HTML length: ${html.length} chars`);

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(".result").each((index, element) => {
      if (results.length >= maxResults) return false;

      const $element = $(element);

      // Skip ads
      if ($element.hasClass("result--ad")) {
        return;
      }

      const $link = $element.find(".result__a");
      const linkUrl = $link.attr("href");
      const title = $link.text().trim();
      const snippet = $element.find(".result__snippet").text().trim();

      if (title && linkUrl) {
        let fullUrl = linkUrl.startsWith("//") ? `https:${linkUrl}` : linkUrl;

        // Extract real URL from DuckDuckGo redirect
        if (fullUrl.includes("duckduckgo.com/l/?uddg=")) {
          try {
            const urlObj = new URL(fullUrl);
            const realUrl = urlObj.searchParams.get("uddg");
            if (realUrl) {
              fullUrl = decodeURIComponent(realUrl);
            }
          } catch (e) {
            // Continue with original URL
          }
        }

        if (!matchesAllowedDomains(fullUrl, allowedDomains)) {
          return;
        }

        results.push({
          title,
          url: fullUrl,
          snippet,
          position: results.length + 1,
        });
      }
    });

    console.log(
      `[DuckDuckGo Search] Found ${results.length} results for "${query}"`
    );

    await page.close();

    return {
      engine: "DuckDuckGo",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    console.error(`[DuckDuckGo Search] Error:`, error);

    if (page) {
      try {
        await page.close();
      } catch (err) {
        // Ignore
      }
    }

    return {
      engine: "DuckDuckGo",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search on Bing using Playwright (visible browser)
 */
export async function searchBingWithPlaywright(
  query: string,
  maxResults: number = 10,
  allowedDomains?: string[]
): Promise<SearchEngineResult> {
  let page: Page | undefined;

  try {
    console.log(`[Bing Search] Searching for: "${query}"`);

    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();
    page = await context.newPage();

    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.bing.com/search?q=${encodedQuery}&count=${maxResults}`;

    console.log(`[Bing Search] Navigating to: ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
      console.log("[Bing Search] Network idle timeout, continuing anyway");
    });

    await page.waitForTimeout(2000);

    const html = await page.content();
    console.log(`[Bing Search] HTML length: ${html.length} chars`);

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(".b_algo").each((index, element) => {
      if (results.length >= maxResults) return false;

      const $element = $(element);
      const $link = $element.find("h2 a");
      const linkUrl = $link.attr("href");
      const title = $link.text().trim();
      const snippet = $element.find(".b_caption p").text().trim();

      if (title && linkUrl && linkUrl.startsWith("http")) {
        if (!matchesAllowedDomains(linkUrl, allowedDomains)) {
          return;
        }

        results.push({
          title,
          url: linkUrl,
          snippet,
          position: results.length + 1,
        });
      }
    });

    console.log(`[Bing Search] Found ${results.length} results for "${query}"`);

    await page.close();

    return {
      engine: "Bing",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    console.error(`[Bing Search] Error:`, error);

    if (page) {
      try {
        await page.close();
      } catch (err) {
        // Ignore
      }
    }

    return {
      engine: "Bing",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
