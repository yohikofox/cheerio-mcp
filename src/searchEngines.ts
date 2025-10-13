import fetch from "node-fetch";
import * as cheerio from "cheerio";

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
 * Search on Google and extract organic results
 */
export async function searchGoogle(
  query: string,
  maxResults: number = 10
): Promise<SearchEngineResult> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encodedQuery}&num=${maxResults}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    console.error(`Google HTML length: ${html.length} chars`);
    console.error(`Google HTML preview: ${html.substring(0, 500)}`);

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const gElements = $(".g");
    console.error(`Found ${gElements.length} elements with class ".g"`);

    // Google organic results selector (excludes ads)
    $(".g").each((index, element) => {
      if (index >= maxResults) return false;

      const $element = $(element);

      // Skip ads (elements with data-text-ad attribute)
      if ($element.find("[data-text-ad]").length > 0) return;

      const $link = $element.find("a[href]").first();
      const url = $link.attr("href");

      // Skip non-http links and Google internal links
      if (!url || !url.startsWith("http") || url.includes("google.com")) return;

      const title = $link.find("h3").text().trim();
      const snippet = $element.find(".VwiC3b, .yXK7lf").text().trim();

      if (title && url) {
        results.push({
          title,
          url,
          snippet,
          position: results.length + 1,
        });
      }
    });

    console.error(
      `Google search for "${query}" returned ${results.length} results.`,
      JSON.stringify({ results }, null, 2)
    );

    return {
      engine: "Google",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    return {
      engine: "Google",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search on DuckDuckGo and extract organic results
 */
export async function searchDuckDuckGo(
  query: string,
  maxResults: number = 10
): Promise<SearchEngineResult> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    console.error(`DuckDuckGo HTML length: ${html.length} chars`);
    console.error(`DuckDuckGo HTML preview: ${html.substring(0, 500)}`);

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const resultElements = $(".result");
    console.error(`Found ${resultElements.length} elements with class ".result"`);

    // DuckDuckGo results selector (excludes ads)
    $(".result").each((index, element) => {
      if (index >= maxResults) return false;

      const $element = $(element);

      // Skip ads
      if ($element.hasClass("result--ad")) {
        console.error(`Skipping ad at index ${index}`);
        return;
      }

      const $link = $element.find(".result__a");
      const url = $link.attr("href");
      const title = $link.text().trim();
      const snippet = $element.find(".result__snippet").text().trim();

      console.error(`Result ${index}: title="${title}", url="${url}", snippet="${snippet.substring(0, 50)}"`);

      if (title && url) {
        // Convert protocol-relative URLs to https
        const fullUrl = url.startsWith("//") ? `https:${url}` : url;

        results.push({
          title,
          url: fullUrl,
          snippet,
          position: results.length + 1,
        });
        console.error(`Added result ${index} with url: ${fullUrl}`);
      } else {
        console.error(`Rejected result ${index}: title=${!!title}, url=${url}`);
      }
    });

    return {
      engine: "DuckDuckGo",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    return {
      engine: "DuckDuckGo",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Search on Bing and extract organic results
 */
export async function searchBing(
  query: string,
  maxResults: number = 10
): Promise<SearchEngineResult> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.bing.com/search?q=${encodedQuery}&count=${maxResults}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Bing organic results selector
    $(".b_algo").each((index, element) => {
      if (index >= maxResults) return false;

      const $element = $(element);
      const $link = $element.find("h2 a");
      const url = $link.attr("href");
      const title = $link.text().trim();
      const snippet = $element.find(".b_caption p").first().text().trim();

      if (title && url && url.startsWith("http")) {
        results.push({
          title,
          url,
          snippet,
          position: results.length + 1,
        });
      }
    });

    return {
      engine: "Bing",
      query,
      results: results.slice(0, maxResults),
    };
  } catch (error) {
    return {
      engine: "Bing",
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
