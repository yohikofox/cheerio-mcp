import fetch from "node-fetch";
import * as cheerio from "cheerio";
import YAML from "yaml";

export interface RawDataItem {
  label?: string;
  value: string;
  type?: "text" | "link" | "image" | "price" | "table";
  attributes?: Record<string, string>;
}

export interface RawPageContent {
  url: string;
  title: string;
  data: RawDataItem[];
  yaml?: string;
}

/**
 * Extract raw data from HTML elements and convert to label/value pairs
 */
function extractRawData(
  $: cheerio.CheerioAPI,
  url: string,
  flatten: boolean = false
): RawDataItem[] {
  const data: RawDataItem[] = [];
  const seen = new Set<string>(); // Avoid duplicates

  // Helper function to clean text
  const cleanText = (text: string): string => {
    return text.replace(/\s+/g, " ").trim();
  };

  // Helper to add data without duplicates
  const addData = (item: RawDataItem) => {
    const key = `${item.label || ""}:${item.value}`;
    if (!seen.has(key) && item.value.length > 0 && item.value.length < 500) {
      seen.add(key);
      data.push(item);
    }
  };

  // Extract from tables (very useful for e-commerce specifications)
  $("table").each((_, table) => {
    const $table = $(table);

    $table.find("tr").each((_, row) => {
      const $row = $(row);
      const cells = $row.find("td, th").toArray();

      if (cells.length === 2) {
        const label = cleanText($(cells[0]).text());
        const value = cleanText($(cells[1]).text());

        if (label && value && label !== value) {
          addData({ label, value, type: "table" });
        }
      }
    });
  });

  // Extract from definition lists
  $("dl").each((_, dl) => {
    const $dl = $(dl);
    $dl.find("dt").each((i, dt) => {
      const label = cleanText($(dt).text());
      const dd = $(dt).next("dd");
      const value = cleanText(dd.text());

      if (label && value) {
        addData({ label, value, type: "text" });
      }
    });
  });

  // Extract headings with their following content
  $("h1, h2, h3, h4").each((_, heading) => {
    const $heading = $(heading);
    const headingText = cleanText($heading.text());

    if (headingText) {
      addData({ value: headingText, type: "text" });
    }
  });

  // Extract all text from divs/spans that look like labels+values
  $('[class*="price"], [class*="amount"], [data-price]').each((_, el) => {
    const $el = $(el);
    const text = cleanText($el.text());

    if (text && text.match(/\d+[\s.,]?\d*\s*[€$]/)) {
      const label = $el.attr("aria-label") || $el.attr("title") || "Price";
      addData({ label, value: text, type: "price" });
    }
  });

  // Extract merchant/retailer information (for comparison sites like Klarna)
  $(
    '[class*="retailer"], [class*="merchant"], [class*="store"], [class*="shop"]'
  ).each((_, el) => {
    const $el = $(el);

    // Get merchant name
    const merchantName = cleanText(
      $el.find('[class*="name"], h3, h4, strong, span').first().text()
    );

    // Get price
    const priceEl = $el.find('[class*="price"], [class*="amount"]').first();
    const price = cleanText(priceEl.text());

    // Get availability/stock
    const availability = cleanText(
      $el
        .find('[class*="stock"], [class*="availability"], [class*="rupture"]')
        .text()
    );

    // Get shipping info
    const shipping = cleanText(
      $el
        .find('[class*="shipping"], [class*="delivery"], [class*="livraison"]')
        .text()
    );

    if (merchantName) {
      addData({ label: "Merchant", value: merchantName, type: "text" });

      if (price) {
        addData({
          label: `${merchantName} - Price`,
          value: price,
          type: "price",
        });
      }

      if (availability) {
        addData({
          label: `${merchantName} - Availability`,
          value: availability,
          type: "text",
        });
      }

      if (shipping) {
        addData({
          label: `${merchantName} - Shipping`,
          value: shipping,
          type: "text",
        });
      }
    }
  });
  // Extract all images
  $("img[src], img[data-src]").each((_, img) => {
    const $img = $(img);
    let src = $img.attr("src") || $img.attr("data-src") || "";
    const alt = $img.attr("alt") || "";

    if (src) {
      // Convert relative URLs to absolute
      if (src.startsWith("/")) {
        const urlObj = new URL(url);
        src = `${urlObj.protocol}//${urlObj.host}${src}`;
      }

      addData({
        label: alt || "Image",
        value: src,
        type: "image",
      });
    }
  });

  // Extract list items
  $("ul > li, ol > li").each((_, li) => {
    const $li = $(li);
    const text = cleanText($li.clone().children().remove().end().text()); // Get direct text only

    if (text) {
      addData({ value: text, type: "text" });
    }
  });

  // Extract paragraphs
  $("p").each((_, p) => {
    const text = cleanText($(p).text());
    if (text && text.length > 10) {
      addData({ value: text, type: "text" });
    }
  });

  return data;
}

/**
 * Scrape page and return raw data in YAML format
 */
export async function scrapePageRaw(
  url: string,
  options: { flatten?: boolean; format?: "json" | "yaml" } = {}
): Promise<RawPageContent> {
  const { flatten = true, format = "yaml" } = options;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract JSON-LD structured data BEFORE cleaning
    const jsonLdData: RawDataItem[] = [];
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const jsonText = $(script).html();
        if (jsonText) {
          const json = JSON.parse(jsonText);
          // Extract product specs if available
          if (json["@type"] === "Product" || json.hasOwnProperty("offers")) {
            Object.entries(json).forEach(([key, value]) => {
              if (typeof value === "string" || typeof value === "number") {
                jsonLdData.push({
                  label: key,
                  value: String(value),
                  type: "table",
                });
              }
            });
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    });

    // Extract embedded JSON data (common in e-commerce sites like Klarna)
    const scriptTexts = $("script:not([src])")
      .toArray()
      .map((s) => $(s).html() || "");
    scriptTexts.forEach((scriptText) => {
      // Look for JSON objects with product specifications
      const jsonMatches = scriptText.match(/\{[^{}]*"attributes"[^{}]*\}/g);
      if (jsonMatches) {
        jsonMatches.forEach((match) => {
          try {
            const json = JSON.parse(match);
            if (json.attributes && Array.isArray(json.attributes)) {
              json.attributes.forEach((attr: any) => {
                if (attr.name && attr.value) {
                  jsonLdData.push({
                    label: attr.name,
                    value: attr.value,
                    type: "table",
                  });
                }
              });
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        });
      }

      // Look for larger JSON structures with nested attributes
      const largeJsonMatch = scriptText.match(
        /\{"[^"]+"\s*:\s*\{[^}]*"attributes"\s*:\s*\[[^\]]+\][^}]*\}/g
      );
      if (largeJsonMatch) {
        largeJsonMatch.forEach((match) => {
          try {
            const json = JSON.parse(match);
            Object.values(json).forEach((category: any) => {
              if (category.attributes && Array.isArray(category.attributes)) {
                category.attributes.forEach((attr: any) => {
                  if (attr.name && attr.value) {
                    jsonLdData.push({
                      label: attr.name,
                      value: attr.value,
                      type: "table",
                    });
                  }
                });
              }
            });
          } catch (e) {
            // Not valid JSON, skip
          }
        });
      }
    });

    // Minimal cleaning - only remove truly non-content elements
    $("script, style, noscript").remove();

    // Extract title
    const title =
      $("title").text().trim() || $("h1").first().text().trim() || "No title";

    // Extract raw data
    const data = [...jsonLdData, ...extractRawData($, url, flatten)];

    // Convert to YAML if requested
    const yaml = format === "yaml" ? YAML.stringify(data) : undefined;

    return {
      url,
      title,
      data,
      yaml,
    };
  } catch (error) {
    return {
      url,
      title: "Error",
      data: [
        {
          label: "Error",
          value: error instanceof Error ? error.message : "Unknown error",
          type: "text",
        },
      ],
    };
  }
}

/**
 * Scrape multiple pages and return raw data
 */
export async function scrapeMultiplePagesRaw(
  urls: string[],
  options: { flatten?: boolean; format?: "json" | "yaml" } = {}
): Promise<RawPageContent[]> {
  const promises = urls.map((url) => scrapePageRaw(url, options));
  return Promise.all(promises);
}
