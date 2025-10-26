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
    interactionSelectors?: string[];
    accordionContent?: AccordionContent[];
  };
}

interface AccordionContent {
  trigger: string;
  selector: string;
  content: string;
  html: string;
  structured?: Record<string, any>;
  length: number;
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
export async function analyzePageStructure(
  url: string,
  interactionSelectors?: string[]
): Promise<PageStructureAnalysis> {
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

    // Try to wait for network idle but don't block if trackers fail
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      console.log('[Page Analyzer] Network idle timeout - continuing anyway (normal for sites with many trackers)');
    });

    // Give a bit more time for initial render
    await page.waitForTimeout(1000);

    // Close any blocking popups/modals/overlays
    console.log('[Page Analyzer] Checking for blocking popups/modals...');

    const closeButtonSelectors = [
      // Generic close buttons
      '[aria-label*="Close" i]',
      '[aria-label*="Fermer" i]',
      'button.close',
      'button[class*="close"]',
      '[data-dismiss="modal"]',
      '[data-dismiss="dialog"]',
      '.modal-close',
      '.popup-close',
      '.dialog-close',
      // Icons and symbols
      'button:has(svg[class*="close"])',
      'button:has([class*="close-icon"])',
      '[class*="close-button"]',
      // Refuse/decline buttons for popups
      'button:has-text("Non merci")',
      'button:has-text("Refuser")',
      'button:has-text("Plus tard")',
      'button:has-text("Continuer sans")',
    ];

    for (const selector of closeButtonSelectors) {
      try {
        const closeButton = await page.$(selector);
        if (closeButton) {
          const isVisible = await closeButton.isVisible();
          if (isVisible) {
            console.log(`[Page Analyzer] Found and clicking close button: ${selector}`);
            await closeButton.click();
            await page.waitForTimeout(500);
          }
        }
      } catch (err) {
        // Button might not exist or not be clickable, continue
      }
    }

    // Press Escape key to close any remaining modals
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    console.log('[Page Analyzer] Popup handling completed');

    // Human-like progressive scrolling to load lazy content FIRST
    console.log('[Page Analyzer] Starting scroll to load dynamic content...');

    const pageInfo = await page.evaluate(() => ({
      height: document.body.scrollHeight,
      viewportHeight: window.innerHeight
    }));

    console.log(`[Page Analyzer] Page height: ${pageInfo.height}, Viewport: ${pageInfo.viewportHeight}`);

    // Scroll down progressively with timeout protection
    const scrollStepMin = 800;  // Increased for faster scrolling
    const scrollStepMax = 1200;
    let currentY = 0;
    const maxScrollTime = 30000; // Max 30 seconds for scrolling
    const scrollStartTime = Date.now();

    while (currentY < pageInfo.height) {
      // Check timeout
      if (Date.now() - scrollStartTime > maxScrollTime) {
        console.log(`[Page Analyzer] Scroll timeout reached after 30s, stopping at ${currentY}px`);
        break;
      }

      const step = Math.floor(Math.random() * (scrollStepMax - scrollStepMin + 1)) + scrollStepMin;
      currentY += step;

      await page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'auto' }); // Changed to 'auto' for faster scroll
      }, currentY);

      await page.waitForTimeout(50); // Reduced delay

      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight > pageInfo.height) {
        pageInfo.height = newHeight;
        console.log(`[Page Analyzer] Content expanded to ${newHeight}px`);
      }
    }

    await page.waitForTimeout(300); // Reduced final wait

    // Scroll back to top
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    await page.waitForTimeout(300);
    console.log('[Page Analyzer] Scrolling completed');

    // Click on custom interaction selectors provided by user AFTER scrolling
    const accordionContents: AccordionContent[] = [];

    if (interactionSelectors && interactionSelectors.length > 0) {
      console.log(`[Page Analyzer] Processing ${interactionSelectors.length} custom interaction selectors...`);

      // Capture HTML before interactions for comparison
      const htmlBefore = await page.content();
      console.log(`[Page Analyzer] HTML size BEFORE interactions: ${htmlBefore.length} characters`);

      for (const selector of interactionSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            console.log(`[Page Analyzer] Found ${elements.length} elements matching: ${selector}`);

            for (let i = 0; i < Math.min(elements.length, 20); i++) {
              try {
                // Check if element is visible and enabled
                const isVisible = await elements[i].isVisible();
                const isEnabled = await elements[i].isEnabled();
                const ariaExpanded = await elements[i].getAttribute('aria-expanded');
                const ariaControls = await elements[i].getAttribute('aria-controls');
                const triggerText = await elements[i].textContent();

                console.log(`[Page Analyzer] Element ${i + 1}: visible=${isVisible}, enabled=${isEnabled}, aria-expanded=${ariaExpanded}, aria-controls=${ariaControls}`);

                // Only click if accordion is NOT already expanded
                if (ariaExpanded === 'false' || ariaExpanded === null) {
                  await elements[i].scrollIntoViewIfNeeded();
                  await page.waitForTimeout(300);

                  await elements[i].click();
                  console.log(`[Page Analyzer] Clicked element ${i + 1}/${elements.length} to OPEN accordion`);

                  // Wait for accordion to open with animation
                  await page.waitForTimeout(1500);
                } else if (ariaExpanded === 'true') {
                  console.log(`[Page Analyzer] Element ${i + 1} is already expanded, skipping click`);
                }

                // Extract accordion content if aria-controls is present
                if (ariaControls) {
                  try {
                    const contentPanel = await page.$(`#${ariaControls}`);
                    if (contentPanel) {
                      // Get HTML to parse structure
                      const innerHTML = await contentPanel.innerHTML();
                      const textContent = await contentPanel.textContent();

                      if (textContent && textContent.trim().length > 0) {
                        // Parse HTML structure for structured data
                        const $panel = cheerio.load(innerHTML);
                        const structured = parseAccordionStructure($panel);

                        accordionContents.push({
                          trigger: triggerText?.trim() || 'Unknown',
                          selector: `#${ariaControls}`,
                          content: textContent.trim(),
                          html: innerHTML,
                          structured: Object.keys(structured).length > 0 ? structured : undefined,
                          length: textContent.trim().length
                        });
                        console.log(`[Page Analyzer] Extracted ${textContent.trim().length} chars and ${Object.keys(structured).length} structured fields from #${ariaControls}`);
                      }
                    }
                  } catch (extractErr) {
                    console.log(`[Page Analyzer] Could not extract content from #${ariaControls}`);
                  }
                }
              } catch (clickErr) {
                console.log(`[Page Analyzer] Could not process element ${i + 1} for selector ${selector}:`, clickErr);
              }
            }
          } else {
            console.log(`[Page Analyzer] No elements found for selector: ${selector}`);
          }
        } catch (err) {
          console.log(`[Page Analyzer] Error processing selector ${selector}:`, err);
        }
      }

      await page.waitForTimeout(2000);

      // Capture HTML after interactions
      const htmlAfter = await page.content();
      console.log(`[Page Analyzer] HTML size AFTER interactions: ${htmlAfter.length} characters`);
      console.log(`[Page Analyzer] HTML size difference: ${htmlAfter.length - htmlBefore.length} characters`);
      console.log(`[Page Analyzer] Extracted content from ${accordionContents.length} accordions`);
      console.log('[Page Analyzer] Custom interactions completed');
    }

    // Get the HTML after scrolling and interactions
    const html = await page.content();
    console.log(`[Page Analyzer] Final HTML captured: ${html.length} characters`);
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
      recommendations,
      interactionSelectors,
      accordionContents
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
        interactionSelectors,
        accordionContent: accordionContents.length > 0 ? accordionContents : undefined,
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
  recommendations: string[],
  interactionSelectors?: string[],
  accordionContents?: AccordionContent[]
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

  // Save complete productInfo with all details (no filtering)
  const config: DomainConfig = {
    domain,
    learnedAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    sampleUrl: url,
    productInfo: productInfo, // Keep all selectors with confidence, values, methods
    structuredData: structuredData, // Keep complete structured data
    extractionStrategy,
    recommendations: recommendations,
    interactionSelectors: interactionSelectors, // Custom selectors for revealing hidden content
    accordionContent: accordionContents && accordionContents.length > 0 ? accordionContents : undefined,
  };

  return config;
}

/**
 * Parse accordion HTML content to extract structured data
 */
function parseAccordionStructure($: cheerio.CheerioAPI): Record<string, any> {
  const result: Record<string, any> = {};

  // Parse tables with key-value pairs
  $('table').each((_, table) => {
    const $table = $(table);

    $table.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();

      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (key && value) {
          result[key] = value;
        }
      }
    });
  });

  // Parse definition lists (dl/dt/dd)
  $('dl').each((_, dl) => {
    const $dl = $(dl);
    $dl.find('dt').each((_, dt) => {
      const key = $(dt).text().trim();
      const $dd = $(dt).next('dd');
      const value = $dd.text().trim();

      if (key && value) {
        result[key] = value;
      }
    });
  });

  // Parse divs with label/value patterns
  $('[class*="label"], [class*="key"]').each((_, label) => {
    const $label = $(label);
    const key = $label.text().trim();

    // Try to find value in next sibling
    const $value = $label.next();
    if ($value.length > 0) {
      const value = $value.text().trim();
      if (key && value && !key.includes(':')) {
        result[key] = value;
      }
    }
  });

  return result;
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
