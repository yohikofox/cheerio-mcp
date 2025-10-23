import * as cheerio from 'cheerio';
import { Page } from 'playwright-core';
import BrowserManager from './browser-manager.js';
import { saveDomainConfig, DomainConfig } from './domain-config-manager.js';
import { URL } from 'url';

export interface PageStructureAnalysis {
  url: string;
  title: string;
  analysis: {
    structuredData: StructuredDataInfo[];
    productInfo: ProductInfoSelectors;
    commonPatterns: PatternInfo[];
    recommendations: string[];
  };
}

interface StructuredDataInfo {
  type: string;
  format: 'json-ld' | 'microdata' | 'rdfa' | 'opengraph';
  selector: string;
  data: any;
}

interface ProductInfoSelectors {
  title?: SelectorMatch[];
  price?: SelectorMatch[];
  images?: SelectorMatch[];
  description?: SelectorMatch[];
  specifications?: SelectorMatch[];
  availability?: SelectorMatch[];
  brand?: SelectorMatch[];
  sku?: SelectorMatch[];
}

interface SelectorMatch {
  selector: string;
  confidence: 'high' | 'medium' | 'low';
  value: string;
  method: string;
}

interface PatternInfo {
  pattern: string;
  description: string;
  examples: string[];
}

/**
 * Analyze a page structure to identify optimal selectors for data extraction
 */
export async function analyzePageStructure(url: string): Promise<PageStructureAnalysis> {
  let page: Page | undefined;

  try {
    console.log(`[Page Analyzer] Analyzing: ${url}`);

    // Use BrowserManager for browser reuse
    const browserManager = BrowserManager.getInstance();
    const context = await browserManager.getContext();
    page = await context.newPage();

    // Navigate to page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      console.log('[Page Analyzer] Network idle timeout');
    });

    await page.waitForTimeout(2000);

    // Get the HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    // Extract page title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

    // 1. Analyze structured data (JSON-LD, Microdata, etc.)
    const structuredData = extractStructuredData($);

    // 2. Identify product information selectors
    const productInfo = identifyProductSelectors($, html);

    // 3. Find common patterns
    const commonPatterns = identifyCommonPatterns($);

    // 4. Generate recommendations
    const recommendations = generateRecommendations(structuredData, productInfo, commonPatterns);

    await page.close();

    // Convert analysis to DomainConfig and save it
    const domainConfig = convertToDomainConfig(
      url,
      structuredData,
      productInfo,
      recommendations
    );
    await saveDomainConfig(domainConfig);

    return {
      url,
      title,
      analysis: {
        structuredData,
        productInfo,
        commonPatterns,
        recommendations,
      },
    };
  } catch (error) {
    if (page) {
      await page.close().catch(() => {});
    }
    throw error;
  }
}

/**
 * Convert analysis to DomainConfig format
 */
function convertToDomainConfig(
  url: string,
  structuredData: StructuredDataInfo[],
  productInfo: ProductInfoSelectors,
  recommendations: string[]
): DomainConfig {
  const urlObj = new URL(url);
  const domain = urlObj.hostname.replace(/^www\./, '');

  // Determine extraction strategy
  const hasJsonLd = structuredData.some(d => d.format === 'json-ld');
  const hasMicrodata = structuredData.some(d => d.format === 'microdata');
  const hasStructured = hasJsonLd || hasMicrodata;

  let extractionStrategy: 'structured' | 'selectors' | 'hybrid' = 'selectors';
  if (hasStructured && Object.keys(productInfo).some(k => (productInfo as any)[k]?.length > 0)) {
    extractionStrategy = 'hybrid';
  } else if (hasStructured) {
    extractionStrategy = 'structured';
  }

  // Extract best selectors (highest confidence)
  const config: DomainConfig = {
    domain,
    learnedAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    sampleUrl: url,
    selectors: {
      title: productInfo.title
        ?.filter(t => t.confidence === 'high')
        .map(t => t.selector)
        .slice(0, 3) || [],
      price: productInfo.price
        ?.filter(p => p.confidence === 'high')
        .map(p => p.selector)
        .slice(0, 3) || [],
      images: productInfo.images
        ?.filter(i => i.confidence === 'high')
        .map(i => i.selector)
        .slice(0, 3) || [],
      brand: productInfo.brand
        ?.filter(b => b.confidence === 'high')
        .map(b => b.selector)
        .slice(0, 2) || [],
      sku: productInfo.sku
        ?.filter(s => s.confidence === 'high')
        .map(s => s.selector)
        .slice(0, 2) || [],
      availability: productInfo.availability
        ?.map(a => a.selector)
        .slice(0, 2) || [],
      specifications: productInfo.specifications
        ?.map(s => ({
          type: s.method.includes('Table') ? 'table' as const :
                s.method.includes('Definition') ? 'dl' as const : 'div-pairs' as const,
          selector: s.selector,
        }))
        .slice(0, 2) || [],
    },
    structuredData: {
      hasJsonLd,
      jsonLdTypes: structuredData
        .filter(d => d.format === 'json-ld')
        .map(d => d.type),
      hasMicrodata,
      microdataTypes: structuredData
        .filter(d => d.format === 'microdata')
        .map(d => d.type),
    },
    extractionStrategy,
    notes: recommendations,
  };

  return config;
}

/**
 * Extract structured data from the page
 */
function extractStructuredData($: cheerio.CheerioAPI): StructuredDataInfo[] {
  const results: StructuredDataInfo[] = [];

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      results.push({
        type: data['@type'] || 'Unknown',
        format: 'json-ld',
        selector: 'script[type="application/ld+json"]',
        data,
      });
    } catch (e) {
      // Invalid JSON
    }
  });

  // Microdata
  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    const itemType = $el.attr('itemtype') || 'Unknown';
    const props: Record<string, string> = {};

    $el.find('[itemprop]').each((_, prop) => {
      const $prop = $(prop);
      const propName = $prop.attr('itemprop') || '';
      const propValue = $prop.attr('content') || $prop.text().trim();
      if (propName) {
        props[propName] = propValue;
      }
    });

    results.push({
      type: itemType.split('/').pop() || 'Unknown',
      format: 'microdata',
      selector: '[itemscope][itemtype*="' + itemType + '"]',
      data: props,
    });
  });

  // OpenGraph
  const ogData: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const $el = $(el);
    const property = $el.attr('property') || '';
    const content = $el.attr('content') || '';
    if (property && content) {
      ogData[property] = content;
    }
  });

  if (Object.keys(ogData).length > 0) {
    results.push({
      type: 'OpenGraph',
      format: 'opengraph',
      selector: 'meta[property^="og:"]',
      data: ogData,
    });
  }

  return results;
}

/**
 * Identify product information selectors
 */
function identifyProductSelectors($: cheerio.CheerioAPI, html: string): ProductInfoSelectors {
  const info: ProductInfoSelectors = {};

  // Title detection (multiple strategies)
  info.title = [];

  // Strategy 1: H1 in main content
  $('main h1, [role="main"] h1, article h1').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10 && text.length < 200) {
      info.title!.push({
        selector: 'main h1, [role="main"] h1, article h1',
        confidence: 'high',
        value: text.substring(0, 100),
        method: 'H1 in main content area',
      });
    }
  });

  // Strategy 2: Product name classes
  $('[class*="product-name"], [class*="product-title"], [itemprop="name"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && !info.title!.some(t => t.value === text)) {
      info.title!.push({
        selector: $(el).attr('class') ? `.${$(el).attr('class')!.split(' ')[0]}` : '[itemprop="name"]',
        confidence: 'high',
        value: text.substring(0, 100),
        method: 'Product-specific class or itemprop',
      });
    }
  });

  // Price detection
  info.price = [];

  // Strategy 1: Microdata/Schema.org
  $('[itemprop="price"], [itemprop="offers"] [itemprop="price"]').each((_, el) => {
    const $el = $(el);
    const value = $el.attr('content') || $el.text().trim();
    if (value && value.match(/\d/)) {
      info.price!.push({
        selector: '[itemprop="price"]',
        confidence: 'high',
        value,
        method: 'Schema.org microdata',
      });
    }
  });

  // Strategy 2: Price classes
  $('[class*="price"], [class*="amount"], [data-price]').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text && text.match(/[\d,. ]+[€$£]/)) {
      const classes = $el.attr('class') || '';
      const mainClass = classes.split(' ').find(c => c.includes('price') || c.includes('amount'));
      info.price!.push({
        selector: mainClass ? `.${mainClass}` : '[data-price]',
        confidence: 'medium',
        value: text,
        method: 'Price-related class names',
      });
    }
  });

  // Images detection
  info.images = [];

  // Strategy 1: Product images with specific classes
  $('[class*="product-image"], [class*="product-gallery"], [itemprop="image"]').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || '';
    if (src) {
      const classes = $el.attr('class') || '';
      const mainClass = classes.split(' ')[0];
      info.images!.push({
        selector: mainClass ? `.${mainClass}` : '[itemprop="image"]',
        confidence: 'high',
        value: src.substring(0, 100),
        method: 'Product image classes or microdata',
      });
    }
  });

  // Specifications detection
  info.specifications = [];

  // Strategy 1: Tables
  $('table').each((i, table) => {
    if (i < 2) { // Only first 2 tables
      const $table = $(table);
      const classes = $table.attr('class') || '';
      const id = $table.attr('id') || '';
      if (classes.match(/spec|feature|detail|fiche|caracteristique/i) ||
          id.match(/spec|feature|detail/i) ||
          $table.find('tr').length > 3) {
        info.specifications!.push({
          selector: classes ? `table.${classes.split(' ')[0]}` : id ? `table#${id}` : 'table',
          confidence: 'high',
          value: `${$table.find('tr').length} rows found`,
          method: 'Table with specification patterns',
        });
      }
    }
  });

  // Strategy 2: Definition lists
  $('dl').each((i, dl) => {
    if (i < 2) {
      const $dl = $(dl);
      const dtCount = $dl.find('dt').length;
      if (dtCount > 0) {
        info.specifications!.push({
          selector: 'dl',
          confidence: 'medium',
          value: `${dtCount} definition terms found`,
          method: 'Definition list structure',
        });
      }
    }
  });

  // Brand detection
  info.brand = [];
  $('[itemprop="brand"], [class*="brand"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 50) {
      info.brand!.push({
        selector: '[itemprop="brand"]',
        confidence: 'high',
        value: text,
        method: 'Brand microdata or class',
      });
    }
  });

  // SKU detection
  info.sku = [];
  $('[itemprop="sku"], [class*="sku"], [class*="reference"], [data-sku]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 50) {
      info.sku!.push({
        selector: '[itemprop="sku"]',
        confidence: 'high',
        value: text,
        method: 'SKU microdata or data attribute',
      });
    }
  });

  // Availability detection
  info.availability = [];
  $('[itemprop="availability"], [class*="stock"], [class*="availability"], [class*="dispo"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 100) {
      const classes = $(el).attr('class') || '';
      const mainClass = classes.split(' ').find(c => c.match(/stock|availab|dispo/i));
      info.availability!.push({
        selector: mainClass ? `.${mainClass}` : '[itemprop="availability"]',
        confidence: 'medium',
        value: text,
        method: 'Availability indicators',
      });
    }
  });

  return info;
}

/**
 * Identify common patterns in the page
 */
function identifyCommonPatterns($: cheerio.CheerioAPI): PatternInfo[] {
  const patterns: PatternInfo[] = [];

  // Check for data attributes
  const dataAttrs = new Set<string>();
  $('*').each((_, el) => {
    if ('attribs' in el && el.attribs) {
      Object.keys(el.attribs).forEach(attr => {
        if (attr.startsWith('data-')) {
          dataAttrs.add(attr);
        }
      });
    }
  });

  if (dataAttrs.size > 0) {
    patterns.push({
      pattern: 'data-* attributes',
      description: 'Custom data attributes used for storing structured information',
      examples: Array.from(dataAttrs).slice(0, 5),
    });
  }

  // Check for BEM-style naming
  const bemClasses: string[] = [];
  $('[class]').each((_, el) => {
    const classes = $(el).attr('class')?.split(' ') || [];
    classes.forEach(cls => {
      if (cls.match(/^[a-z]+(?:__[a-z]+)?(?:--[a-z]+)?$/i)) {
        bemClasses.push(cls);
      }
    });
  });

  if (bemClasses.length > 10) {
    patterns.push({
      pattern: 'BEM Methodology',
      description: 'Uses Block Element Modifier naming convention',
      examples: [...new Set(bemClasses)].slice(0, 5),
    });
  }

  // Check for component-based classes
  const componentClasses = new Set<string>();
  $('[class*="component-"], [class*="c-"]').each((_, el) => {
    const classes = $(el).attr('class')?.split(' ') || [];
    classes.forEach(cls => {
      if (cls.startsWith('component-') || cls.match(/^c-[a-z]/)) {
        componentClasses.add(cls);
      }
    });
  });

  if (componentClasses.size > 0) {
    patterns.push({
      pattern: 'Component-based CSS',
      description: 'Uses component or utility-based class naming',
      examples: Array.from(componentClasses).slice(0, 5),
    });
  }

  return patterns;
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(
  structuredData: StructuredDataInfo[],
  productInfo: ProductInfoSelectors,
  patterns: PatternInfo[]
): string[] {
  const recommendations: string[] = [];

  // Check for JSON-LD
  const jsonLd = structuredData.find(d => d.format === 'json-ld' && d.type === 'Product');
  if (jsonLd) {
    recommendations.push(
      '✅ Best practice: This page uses JSON-LD structured data for Product. ' +
      'Use `script[type="application/ld+json"]` and parse the JSON for reliable data extraction.'
    );
  }

  // Check for microdata
  const microdata = structuredData.find(d => d.format === 'microdata');
  if (microdata && !jsonLd) {
    recommendations.push(
      '✅ This page uses Microdata (schema.org). Use `[itemprop="..."]` selectors for reliable extraction.'
    );
  }

  // Title recommendations
  if (productInfo.title && productInfo.title.length > 0) {
    const highConfidence = productInfo.title.filter(t => t.confidence === 'high');
    if (highConfidence.length > 0) {
      recommendations.push(
        `✅ Product title: Use \`${highConfidence[0].selector}\` for high-confidence extraction.`
      );
    }
  }

  // Price recommendations
  if (productInfo.price && productInfo.price.length > 0) {
    const highConfidence = productInfo.price.filter(p => p.confidence === 'high');
    if (highConfidence.length > 0) {
      recommendations.push(
        `✅ Price: Use \`${highConfidence[0].selector}\` for reliable price extraction.`
      );
    }
  }

  // Specifications recommendations
  if (productInfo.specifications && productInfo.specifications.length > 0) {
    recommendations.push(
      `✅ Specifications: Found ${productInfo.specifications.length} potential sources. ` +
      `Primary selector: \`${productInfo.specifications[0].selector}\``
    );
  }

  // General recommendations
  if (!jsonLd && !microdata) {
    recommendations.push(
      '⚠️  No structured data found. Extraction will rely on CSS selectors and may be fragile to HTML changes.'
    );
  }

  if (patterns.some(p => p.pattern.includes('data-*'))) {
    recommendations.push(
      '💡 Tip: This site uses data-* attributes extensively. These can be more stable than class names.'
    );
  }

  return recommendations;
}
