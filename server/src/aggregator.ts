import { RawDataItem, RawPageContent } from "./scraper-playwright.js";

/**
 * Interface for aggregated data with source tracking
 */
export interface AggregatedDataItem extends RawDataItem {
  sources: string[]; // URLs where this item was found
  frequency: number; // Number of sources that have this item
}

/**
 * Normalized key for deduplication
 */
function normalizeKey(item: RawDataItem): string {
  const label = (item.label || "").toLowerCase().trim();
  const value = item.value.toLowerCase().trim();
  const type = item.type || "text";
  return `${type}:${label}:${value}`;
}

/**
 * Check if two values are similar enough to be considered duplicates
 */
function areSimilar(value1: string, value2: string, threshold: number = 0.9): boolean {
  const v1 = value1.toLowerCase().trim();
  const v2 = value2.toLowerCase().trim();

  // Exact match
  if (v1 === v2) return true;

  // One contains the other (for partial matches)
  if (v1.includes(v2) || v2.includes(v1)) {
    const shorter = Math.min(v1.length, v2.length);
    const longer = Math.max(v1.length, v2.length);
    // If the shorter string is at least 90% of the longer, consider it similar
    return shorter / longer >= threshold;
  }

  return false;
}

/**
 * Aggregate scraped data from multiple pages, removing duplicates and tracking sources
 */
export function aggregateScrapedData(
  scrapedPages: RawPageContent[],
  options: {
    minFrequency?: number; // Only include items found in at least N sources
    deduplicateSimilar?: boolean; // Use fuzzy matching for deduplication
  } = {}
): {
  aggregatedData: AggregatedDataItem[];
  stats: {
    totalSources: number;
    totalItems: number;
    uniqueItems: number;
    duplicatesRemoved: number;
  };
} {
  const { minFrequency = 1, deduplicateSimilar = true } = options;

  // Map to track items by normalized key
  const itemMap = new Map<string, AggregatedDataItem>();

  let totalItems = 0;

  // First pass: collect all items and track sources
  for (const page of scrapedPages) {
    for (const item of page.data) {
      totalItems++;

      const key = normalizeKey(item);

      if (itemMap.has(key)) {
        // Item already exists, add this source
        const existing = itemMap.get(key)!;
        if (!existing.sources.includes(page.url)) {
          existing.sources.push(page.url);
          existing.frequency++;
        }
      } else {
        // New item
        itemMap.set(key, {
          ...item,
          sources: [page.url],
          frequency: 1,
        });
      }
    }
  }

  let aggregatedData = Array.from(itemMap.values());

  // Second pass: deduplicate similar items if enabled
  if (deduplicateSimilar) {
    const deduplicatedData: AggregatedDataItem[] = [];
    const processed = new Set<string>();

    for (const item of aggregatedData) {
      const itemKey = normalizeKey(item);
      if (processed.has(itemKey)) continue;

      // Find all similar items
      const similarItems = aggregatedData.filter((other) => {
        const otherKey = normalizeKey(other);
        return (
          !processed.has(otherKey) &&
          item.type === other.type &&
          (item.label || "") === (other.label || "") &&
          areSimilar(item.value, other.value)
        );
      });

      if (similarItems.length > 0) {
        // Merge similar items
        const mergedItem: AggregatedDataItem = {
          ...item,
          sources: [],
          frequency: 0,
        };

        for (const similar of similarItems) {
          // Merge sources
          for (const source of similar.sources) {
            if (!mergedItem.sources.includes(source)) {
              mergedItem.sources.push(source);
            }
          }
          processed.add(normalizeKey(similar));
        }

        mergedItem.frequency = mergedItem.sources.length;

        // Use the longest value as the canonical one
        mergedItem.value = similarItems.reduce((longest, current) =>
          current.value.length > longest.value.length ? current : longest
        ).value;

        deduplicatedData.push(mergedItem);
      }
    }

    aggregatedData = deduplicatedData;
  }

  // Filter by minimum frequency
  aggregatedData = aggregatedData.filter(
    (item) => item.frequency >= minFrequency
  );

  // Sort by frequency (most common first)
  aggregatedData.sort((a, b) => b.frequency - a.frequency);

  return {
    aggregatedData,
    stats: {
      totalSources: scrapedPages.length,
      totalItems,
      uniqueItems: aggregatedData.length,
      duplicatesRemoved: totalItems - aggregatedData.length,
    },
  };
}

/**
 * Format aggregated data as YAML
 */
export function formatAggregatedDataAsYAML(
  aggregatedData: AggregatedDataItem[],
  stats: any
): string {
  let yaml = `# Aggregated Data\n`;
  yaml += `# Total Sources: ${stats.totalSources}\n`;
  yaml += `# Total Items: ${stats.totalItems}\n`;
  yaml += `# Unique Items: ${stats.uniqueItems}\n`;
  yaml += `# Duplicates Removed: ${stats.duplicatesRemoved}\n\n`;

  for (const item of aggregatedData) {
    yaml += `- label: ${item.label || "N/A"}\n`;
    yaml += `  value: ${JSON.stringify(item.value)}\n`;
    yaml += `  type: ${item.type}\n`;
    yaml += `  frequency: ${item.frequency}\n`;
    yaml += `  sources:\n`;
    for (const source of item.sources) {
      yaml += `    - ${source}\n`;
    }
    yaml += `\n`;
  }

  return yaml;
}
