import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export interface ProductPrice {
  amount: string;
  currency?: string;
  merchant?: string;
  availability?: string;
  shipping?: string;
  url?: string;
}

export interface ProductSpecification {
  category?: string;
  name: string;
  value: string;
}

export interface ProductVariant {
  name: string;
  value: string;
  price?: string;
  url?: string;
  available?: boolean;
}

export interface ProductData {
  mainPrice?: ProductPrice;
  merchantPrices?: ProductPrice[];
  specifications?: ProductSpecification[];
  variants?: ProductVariant[];
  relatedProducts?: Array<{
    title: string;
    price?: string;
    image?: string;
    url?: string;
  }>;
}

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
  productData?: ProductData;
  error?: string;
}

/**
 * Extract product price information from the page
 */
function extractProductPrices($: cheerio.CheerioAPI, url: string): ProductData['merchantPrices'] {
  const prices: ProductPrice[] = [];

  // Common price patterns for e-commerce sites
  const priceSelectors = [
    '.price', '[class*="price"]', '[data-price]',
    '[itemprop="price"]', '.amount', '[class*="Amount"]',
    '[class*="retailer"]', '[class*="merchant"]', '[class*="store"]'
  ];

  // Extract prices with merchant info (for comparison sites like Klarna)
  $('[class*="retailer"], [class*="merchant"], [class*="store"]').each((_, el) => {
    const $el = $(el);
    const merchant = $el.find('[class*="name"], h3, h4, strong').first().text().trim();
    const priceText = $el.find('[class*="price"], [class*="amount"]').first().text().trim();
    const availability = $el.find('[class*="stock"], [class*="availability"]').text().trim();
    const shipping = $el.find('[class*="shipping"], [class*="delivery"]').text().trim();
    const productUrl = $el.find('a[href]').first().attr('href');

    if (priceText && merchant) {
      const priceMatch = priceText.match(/(\d+[\s.,]?\d*)/);
      if (priceMatch) {
        prices.push({
          amount: priceMatch[1].replace(/\s/g, ''),
          currency: priceText.includes('€') ? 'EUR' : priceText.includes('$') ? 'USD' : undefined,
          merchant,
          availability: availability || undefined,
          shipping: shipping || undefined,
          url: productUrl
        });
      }
    }
  });

  return prices.length > 0 ? prices : undefined;
}

/**
 * Extract main product price
 */
function extractMainPrice($: cheerio.CheerioAPI): ProductData['mainPrice'] {
  // Try common price selectors
  const priceSelectors = [
    '[itemprop="price"]',
    '[class*="price"][class*="main"]',
    '[class*="price"][class*="current"]',
    '[data-price]',
    '.price',
    '[class*="Price"]'
  ];

  for (const selector of priceSelectors) {
    const $price = $(selector).first();
    if ($price.length) {
      const priceText = $price.text().trim() || $price.attr('content') || $price.attr('data-price');
      if (priceText) {
        const priceMatch = priceText.match(/(\d+[\s.,]?\d*)/);
        if (priceMatch) {
          return {
            amount: priceMatch[1].replace(/\s/g, ''),
            currency: priceText.includes('€') ? 'EUR' : priceText.includes('$') ? 'USD' : undefined
          };
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract product specifications from tables
 */
function extractSpecifications($: cheerio.CheerioAPI): ProductData['specifications'] {
  const specs: ProductSpecification[] = [];

  // Find tables with specifications
  $('table').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text().toLowerCase();

    // Check if this looks like a specifications table
    if (tableText.includes('caractéristique') ||
        tableText.includes('spécification') ||
        tableText.includes('feature') ||
        tableText.includes('specs')) {

      // Extract rows
      $table.find('tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td, th').toArray();

        if (cells.length >= 2) {
          const name = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();

          if (name && value && name !== value) {
            specs.push({ name, value });
          }
        }
      });
    }
  });

  // Also try definition lists (dl/dt/dd)
  $('dl').each((_, dl) => {
    const $dl = $(dl);
    const $terms = $dl.find('dt');
    const $descriptions = $dl.find('dd');

    $terms.each((i, term) => {
      const name = $(term).text().trim();
      const value = $descriptions.eq(i).text().trim();

      if (name && value) {
        specs.push({ name, value });
      }
    });
  });

  return specs.length > 0 ? specs : undefined;
}

/**
 * Extract product variants (colors, sizes, capacities, etc.)
 */
function extractVariants($: cheerio.CheerioAPI): ProductData['variants'] {
  const variants: ProductVariant[] = [];

  // Look for variant selectors (common patterns)
  const variantPatterns = [
    { selector: '[class*="variant"]', type: 'variant' },
    { selector: '[class*="color"]', type: 'Couleur' },
    { selector: '[class*="size"]', type: 'Taille' },
    { selector: '[class*="capacity"]', type: 'Capacité' },
    { selector: '[class*="storage"]', type: 'Stockage' }
  ];

  variantPatterns.forEach(({ selector, type }) => {
    $(selector).each((_, el) => {
      const $el = $(el);

      // Look for select/option elements
      if ($el.is('select')) {
        $el.find('option').each((_, option) => {
          const $option = $(option);
          const value = $option.text().trim();
          const price = $option.attr('data-price');
          const available = !$option.is(':disabled');

          if (value) {
            variants.push({
              name: type,
              value,
              price,
              available
            });
          }
        });
      }

      // Look for buttons or links
      if ($el.is('a, button, [role="button"]')) {
        const value = $el.text().trim() || $el.attr('aria-label') || $el.attr('title');
        const url = $el.attr('href');
        const price = $el.find('[class*="price"]').text().trim();
        const available = !$el.hasClass('disabled') && !$el.attr('disabled');

        if (value) {
          variants.push({
            name: type,
            value,
            price: price || undefined,
            url: url || undefined,
            available
          });
        }
      }
    });
  });

  return variants.length > 0 ? variants : undefined;
}

/**
 * Extract related/similar products
 */
function extractRelatedProducts($: cheerio.CheerioAPI, baseUrl: string): ProductData['relatedProducts'] {
  const products: ProductData['relatedProducts'] = [];

  // Look for product cards in common sections
  const sections = [
    '[class*="similar"]', '[class*="related"]', '[class*="recommend"]',
    '[class*="produit"]', '[class*="product"]'
  ];

  sections.forEach(selector => {
    $(selector).find('[class*="card"], [class*="item"], article').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h1, h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim();
      const price = $el.find('[class*="price"], [class*="amount"]').first().text().trim();
      const image = $el.find('img').first().attr('src');
      const url = $el.find('a[href]').first().attr('href');

      if (title && (price || image || url)) {
        // Convert relative URLs to absolute
        let absoluteUrl = url;
        if (url && url.startsWith('/')) {
          const urlObj = new URL(baseUrl);
          absoluteUrl = `${urlObj.protocol}//${urlObj.host}${url}`;
        }

        let absoluteImage = image;
        if (image && image.startsWith('/')) {
          const urlObj = new URL(baseUrl);
          absoluteImage = `${urlObj.protocol}//${urlObj.host}${image}`;
        }

        products.push({
          title,
          price: price || undefined,
          image: absoluteImage,
          url: absoluteUrl
        });
      }
    });
  });

  return products.length > 0 ? products.slice(0, 10) : undefined;
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

    // Extract product data
    const mainPrice = extractMainPrice($);
    const merchantPrices = extractProductPrices($, url);
    const specifications = extractSpecifications($);
    const variants = extractVariants($);
    const relatedProducts = extractRelatedProducts($, url);

    const productData: ProductData | undefined =
      (mainPrice || merchantPrices || specifications || variants || relatedProducts)
        ? {
            mainPrice,
            merchantPrices,
            specifications,
            variants,
            relatedProducts
          }
        : undefined;

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
      },
      productData
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
