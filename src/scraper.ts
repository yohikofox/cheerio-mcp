import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export interface PageContent {
  url: string;
  title: string;
  description?: string;
  text: string;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  links: Array<{
    text: string;
    url: string;
  }>;
  images: Array<{
    src: string;
    alt: string;
  }>;
  metadata: {
    author?: string;
    publishedDate?: string;
    keywords?: string[];
  };
  error?: string;
}

/**
 * Extract content from a web page using Cheerio
 */
export async function scrapePage(url: string): Promise<PageContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script, style, and other non-content elements
    $('script, style, nav, footer, header, aside, .ad, .advertisement, [class*="cookie"]').remove();

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

    // Extract meta description
    const description = $('meta[name="description"]').attr('content')?.trim() ||
                       $('meta[property="og:description"]').attr('content')?.trim();

    // Extract headings
    const h1 = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
    const h2 = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean);
    const h3 = $('h3').map((_, el) => $(el).text().trim()).get().filter(Boolean);

    // Extract main text content
    const textContent = $('p, article, main, [role="main"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join('\n\n');

    // Extract links
    const links = $('a[href]')
      .map((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const text = $el.text().trim();

        if (!href || !text) return null;

        // Convert relative URLs to absolute
        let absoluteUrl = href;
        if (href.startsWith('/')) {
          const urlObj = new URL(url);
          absoluteUrl = `${urlObj.protocol}//${urlObj.host}${href}`;
        } else if (!href.startsWith('http')) {
          absoluteUrl = new URL(href, url).href;
        }

        return { text, url: absoluteUrl };
      })
      .get()
      .filter((link): link is { text: string; url: string } => link !== null)
      .slice(0, 50); // Limit to 50 links

    // Extract images
    const images = $('img[src]')
      .map((_, el) => {
        const $el = $(el);
        let src = $el.attr('src');
        const alt = $el.attr('alt')?.trim() || '';

        if (!src) return null;

        // Convert relative URLs to absolute
        if (src.startsWith('/')) {
          const urlObj = new URL(url);
          src = `${urlObj.protocol}//${urlObj.host}${src}`;
        } else if (!src.startsWith('http')) {
          src = new URL(src, url).href;
        }

        return { src, alt };
      })
      .get()
      .filter((img): img is { src: string; alt: string } => img !== null)
      .slice(0, 20); // Limit to 20 images

    // Extract metadata
    const author = $('meta[name="author"]').attr('content')?.trim() ||
                  $('meta[property="article:author"]').attr('content')?.trim();

    const publishedDate = $('meta[property="article:published_time"]').attr('content')?.trim() ||
                         $('time[datetime]').attr('datetime')?.trim();

    const keywordsStr = $('meta[name="keywords"]').attr('content')?.trim();
    const keywords = keywordsStr ? keywordsStr.split(',').map(k => k.trim()) : undefined;

    return {
      url,
      title,
      description,
      text: textContent.slice(0, 10000), // Limit text to 10k characters
      headings: { h1, h2, h3 },
      links,
      images,
      metadata: {
        author,
        publishedDate,
        keywords,
      }
    };
  } catch (error) {
    return {
      url,
      title: 'Error',
      text: '',
      headings: { h1: [], h2: [], h3: [] },
      links: [],
      images: [],
      metadata: {},
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Scrape multiple pages in parallel
 */
export async function scrapeMultiplePages(urls: string[]): Promise<PageContent[]> {
  const promises = urls.map(url => scrapePage(url));
  return Promise.all(promises);
}
