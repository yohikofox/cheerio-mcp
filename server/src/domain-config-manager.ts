import * as fs from 'fs/promises';
import * as path from 'path';
import { URL } from 'url';

export interface SelectorMatch {
  selector: string;
  confidence: 'high' | 'medium' | 'low';
  value: string;
  method: string;
}

export interface SpecificationSelector {
  type: 'table' | 'dl' | 'div-pairs';
  selector: string;
  labelSelector?: string;
  valueSelector?: string;
}

export interface ProductInfoSelectors {
  title?: SelectorMatch[];
  price?: SelectorMatch[];
  images?: SelectorMatch[];
  description?: SelectorMatch[];
  specifications?: SelectorMatch[];
  brand?: SelectorMatch[];
  sku?: SelectorMatch[];
  availability?: SelectorMatch[];
  rating?: SelectorMatch[];
}

export interface RevealedContent {
  trigger: string;
  selector: string;
  content: string;
  html: string;
  structured?: Record<string, any>;
  fieldsToExtract?: string[];  // Liste des champs à extraire depuis structured
  length: number;
}

export interface DomainConfig {
  domain: string;
  learnedAt: string;
  lastUsed: string;
  sampleUrl: string;
  productInfo: ProductInfoSelectors;
  structuredData: any[];
  extractionStrategy: 'structured' | 'selectors' | 'hybrid';
  recommendations: string[];
  interactionSelectors?: string[];
  revealedContent?: RevealedContent[];
}

const CONFIG_DIR = path.join(process.cwd(), 'domain-configs');

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (err) {
    console.error('[DomainConfig] Failed to create config directory:', err);
  }
}

/**
 * Get domain from URL
 */
function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove www. prefix
    return urlObj.hostname.replace(/^www\./, '');
  } catch (err) {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Get config file path for a domain
 */
function getConfigPath(domain: string): string {
  // Replace dots with underscores for safe filename
  const safeDomain = domain.replace(/\./g, '_');
  return path.join(CONFIG_DIR, `${safeDomain}.json`);
}

/**
 * Save domain configuration
 */
export async function saveDomainConfig(config: DomainConfig): Promise<void> {
  await ensureConfigDir();
  const configPath = getConfigPath(config.domain);

  console.log(`[DomainConfig] Saving config for ${config.domain}`);

  try {
    await fs.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
    console.log(`[DomainConfig] Config saved: ${configPath}`);
  } catch (err) {
    console.error(`[DomainConfig] Failed to save config:`, err);
    throw err;
  }
}

/**
 * Load domain configuration
 */
export async function loadDomainConfig(urlOrDomain: string): Promise<DomainConfig | null> {
  await ensureConfigDir();

  const domain = urlOrDomain.startsWith('http')
    ? getDomainFromUrl(urlOrDomain)
    : urlOrDomain;

  const configPath = getConfigPath(domain);

  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data) as DomainConfig;

    // Update last used timestamp
    config.lastUsed = new Date().toISOString();
    await saveDomainConfig(config).catch(() => {}); // Non-blocking

    console.log(`[DomainConfig] Loaded config for ${domain}`);
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`[DomainConfig] No config found for ${domain}`);
      return null;
    }
    console.error(`[DomainConfig] Failed to load config:`, err);
    return null;
  }
}

/**
 * List all saved domain configurations
 */
export async function listDomainConfigs(): Promise<string[]> {
  await ensureConfigDir();

  try {
    const files = await fs.readdir(CONFIG_DIR);
    const domains = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/_/g, '.').replace('.json', ''));

    return domains;
  } catch (err) {
    console.error('[DomainConfig] Failed to list configs:', err);
    return [];
  }
}

/**
 * Delete domain configuration
 */
export async function deleteDomainConfig(domain: string): Promise<void> {
  const configPath = getConfigPath(domain);

  try {
    await fs.unlink(configPath);
    console.log(`[DomainConfig] Deleted config for ${domain}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[DomainConfig] Failed to delete config:`, err);
      throw err;
    }
  }
}

/**
 * Check if domain has a saved configuration
 */
export async function hasDomainConfig(urlOrDomain: string): Promise<boolean> {
  const config = await loadDomainConfig(urlOrDomain);
  return config !== null;
}

/**
 * Update specific fields of an existing domain configuration
 */
export async function updateDomainConfig(
  urlOrDomain: string,
  updates: Partial<DomainConfig>,
  mergeMode: 'merge' | 'replace' = 'merge'
): Promise<DomainConfig> {
  // Load existing config
  const existingConfig = await loadDomainConfig(urlOrDomain);

  if (!existingConfig) {
    throw new Error(`No configuration found for domain: ${urlOrDomain}`);
  }

  let updatedConfig: DomainConfig;

  if (mergeMode === 'replace') {
    // Replace mode: keep only domain, learnedAt, sampleUrl from existing, replace everything else
    updatedConfig = {
      domain: existingConfig.domain,
      learnedAt: existingConfig.learnedAt,
      sampleUrl: existingConfig.sampleUrl,
      lastUsed: new Date().toISOString(),
      productInfo: updates.productInfo || {},
      structuredData: updates.structuredData || [],
      extractionStrategy: updates.extractionStrategy || 'selectors',
      recommendations: updates.recommendations || [],
      interactionSelectors: updates.interactionSelectors,
      revealedContent: updates.revealedContent,
    };
  } else {
    // Merge mode: deep merge of updates into existing config
    updatedConfig = {
      ...existingConfig,
      ...updates,
      lastUsed: new Date().toISOString(),
      // Deep merge productInfo if provided
      productInfo: updates.productInfo
        ? { ...existingConfig.productInfo, ...updates.productInfo }
        : existingConfig.productInfo,
      // Merge arrays if provided, otherwise keep existing
      structuredData: updates.structuredData !== undefined
        ? updates.structuredData
        : existingConfig.structuredData,
      recommendations: updates.recommendations !== undefined
        ? updates.recommendations
        : existingConfig.recommendations,
      interactionSelectors: updates.interactionSelectors !== undefined
        ? updates.interactionSelectors
        : existingConfig.interactionSelectors,
      revealedContent: updates.revealedContent !== undefined
        ? updates.revealedContent
        : existingConfig.revealedContent,
    };
  }

  // Save updated config
  await saveDomainConfig(updatedConfig);

  console.log(`[DomainConfig] Updated config for ${updatedConfig.domain} (mode: ${mergeMode})`);

  return updatedConfig;
}
