#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { searchGoogle, searchDuckDuckGo, searchBing, SearchEngineResult } from './searchEngines.js';
import { searchDuckDuckGoDynamic, searchBingDynamic } from './searchEngines-dynamic.js';
import { searchGoogleStealth, searchGoogleAPI } from './searchEngines-google.js';
import { scrapePage, scrapeMultiplePages, PageContent } from './scraper.js';
import { scrapePageRaw, scrapeMultiplePagesRaw, RawPageContent } from './scraper-raw.js';
import { scrapePageWithPlaywright, scrapeMultiplePagesWithPlaywright } from './scraper-playwright.js';
import { downloadImage, imageToBase64 } from './image-utils.js';

const server = new Server(
  {
    name: 'web-search-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_web',
        description: 'Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results (excluding ads). Fast but limited. Returns up to 10 non-commercial results per engine.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string',
            },
            engines: {
              type: 'array',
              description: 'List of search engines to use. Available: google, duckduckgo, bing. Default: all',
              items: {
                type: 'string',
                enum: ['google', 'duckduckgo', 'bing'],
              },
              default: ['google', 'duckduckgo', 'bing'],
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results per engine (1-10). Default: 10',
              minimum: 1,
              maximum: 10,
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_web_dynamic',
        description: 'Search the web using headless browser (Playwright) for richer results from DuckDuckGo and Bing. Slower but more complete.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string',
            },
            engines: {
              type: 'array',
              description: 'List of search engines to use. Available: duckduckgo, bing. Default: duckduckgo',
              items: {
                type: 'string',
                enum: ['duckduckgo', 'bing'],
              },
              default: ['duckduckgo'],
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results per engine (1-20). Default: 10',
              minimum: 1,
              maximum: 20,
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_google_stealth',
        description: 'Search Google using stealth mode (anti-bot bypass) with human-like behavior. Uses delays, cookie handling, and browser fingerprint masking. Slower but can bypass CAPTCHA.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (1-20). Default: 10',
              minimum: 1,
              maximum: 20,
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_google_api',
        description: 'Search Google using official Custom Search API. Requires API key and Search Engine ID. No CAPTCHA, reliable, but limited to 100 free queries/day.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string',
            },
            apiKey: {
              type: 'string',
              description: 'Google Custom Search API key',
            },
            searchEngineId: {
              type: 'string',
              description: 'Google Custom Search Engine ID (CX parameter)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (1-10). Default: 10',
              minimum: 1,
              maximum: 10,
              default: 10,
            },
          },
          required: ['query', 'apiKey', 'searchEngineId'],
        },
      },
      {
        name: 'scrape_page',
        description: 'Extract content from a web page including title, text, headings, links, images, and metadata using Cheerio.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the page to scrape',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'scrape_multiple_pages',
        description: 'Extract content from multiple web pages in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              description: 'Array of URLs to scrape',
              items: {
                type: 'string',
              },
            },
          },
          required: ['urls'],
        },
      },
      {
        name: 'search_and_scrape',
        description: 'Perform a web search and automatically scrape the content of the top results. This combines search and scraping in one operation.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query string',
            },
            engine: {
              type: 'string',
              description: 'Search engine to use. Available: google, duckduckgo, bing. Default: google',
              enum: ['google', 'duckduckgo', 'bing'],
              default: 'google',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to scrape (1-10). Default: 5',
              minimum: 1,
              maximum: 10,
              default: 5,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'scrape_page_raw',
        description: 'Extract raw structured data from a web page as label/value pairs in YAML or JSON format. Perfect for e-commerce sites with tables, prices, specifications.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the page to scrape',
            },
            flatten: {
              type: 'boolean',
              description: 'Flatten the data structure (default: true)',
              default: true,
            },
            format: {
              type: 'string',
              description: 'Output format: yaml or json (default: yaml)',
              enum: ['yaml', 'json'],
              default: 'yaml',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'scrape_multiple_pages_raw',
        description: 'Extract raw structured data from multiple web pages in parallel.',
        inputSchema: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              description: 'Array of URLs to scrape',
              items: {
                type: 'string',
              },
            },
            flatten: {
              type: 'boolean',
              description: 'Flatten the data structure (default: true)',
              default: true,
            },
            format: {
              type: 'string',
              description: 'Output format: yaml or json (default: yaml)',
              enum: ['yaml', 'json'],
              default: 'yaml',
            },
          },
          required: ['urls'],
        },
      },
      {
        name: 'scrape_page_dynamic',
        description: 'Extract raw data from a JavaScript-heavy web page using headless browser (Playwright). Perfect for sites with dynamic content like Klarna, SPAs, etc. Returns label/value pairs in YAML or JSON.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the page to scrape',
            },
            flatten: {
              type: 'boolean',
              description: 'Flatten the data structure (default: true)',
              default: true,
            },
            format: {
              type: 'string',
              description: 'Output format: yaml or json (default: yaml)',
              enum: ['yaml', 'json'],
              default: 'yaml',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'scrape_multiple_pages_dynamic',
        description: 'Extract raw data from multiple JavaScript-heavy web pages using headless browser.',
        inputSchema: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              description: 'Array of URLs to scrape',
              items: {
                type: 'string',
              },
            },
            flatten: {
              type: 'boolean',
              description: 'Flatten the data structure (default: true)',
              default: true,
            },
            format: {
              type: 'string',
              description: 'Output format: yaml or json (default: yaml)',
              enum: ['yaml', 'json'],
              default: 'yaml',
            },
          },
          required: ['urls'],
        },
      },
      {
        name: 'download_image',
        description: 'Download an image from a URL and save it to the local file system. Returns the file path and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the image to download',
            },
            outputPath: {
              type: 'string',
              description: 'Optional custom output path. If not provided, saves to ./downloads/{random-name}',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'image_to_base64',
        description: 'Convert an image to base64 data URL format. Accepts either a URL (http/https) or a local file path.',
        inputSchema: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: 'Either a URL (http/https) or a local file path to the image',
            },
          },
          required: ['input'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'search_web') {
      const { query, engines = ['google', 'duckduckgo', 'bing'], maxResults = 10 } = args as {
        query: string;
        engines?: string[];
        maxResults?: number;
      };

      const searchPromises: Promise<SearchEngineResult>[] = [];

      if (engines.includes('google')) {
        searchPromises.push(searchGoogle(query, maxResults));
      }
      if (engines.includes('duckduckgo')) {
        searchPromises.push(searchDuckDuckGo(query, maxResults));
      }
      if (engines.includes('bing')) {
        searchPromises.push(searchBing(query, maxResults));
      }

      const results = await Promise.all(searchPromises);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (name === 'search_web_dynamic') {
      const { query, engines = ['duckduckgo'], maxResults = 10 } = args as {
        query: string;
        engines?: string[];
        maxResults?: number;
      };

      const searchPromises: Promise<SearchEngineResult>[] = [];

      if (engines.includes('duckduckgo')) {
        searchPromises.push(searchDuckDuckGoDynamic(query, maxResults));
      }
      if (engines.includes('bing')) {
        searchPromises.push(searchBingDynamic(query, maxResults));
      }

      const results = await Promise.all(searchPromises);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (name === 'search_google_stealth') {
      const { query, maxResults = 10 } = args as {
        query: string;
        maxResults?: number;
      };

      const result = await searchGoogleStealth(query, maxResults);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([result], null, 2),
          },
        ],
      };
    }

    if (name === 'search_google_api') {
      const { query, apiKey, searchEngineId, maxResults = 10 } = args as {
        query: string;
        apiKey: string;
        searchEngineId: string;
        maxResults?: number;
      };

      const result = await searchGoogleAPI(query, apiKey, searchEngineId, maxResults);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([result], null, 2),
          },
        ],
      };
    }

    if (name === 'scrape_page') {
      const { url } = args as { url: string };
      const content = await scrapePage(url);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(content, null, 2),
          },
        ],
      };
    }

    if (name === 'scrape_multiple_pages') {
      const { urls } = args as { urls: string[] };
      const contents = await scrapeMultiplePages(urls);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(contents, null, 2),
          },
        ],
      };
    }

    if (name === 'search_and_scrape') {
      const { query, engine = 'google', maxResults = 5 } = args as {
        query: string;
        engine?: string;
        maxResults?: number;
      };

      // Perform search
      let searchResult: SearchEngineResult;
      switch (engine) {
        case 'google':
          searchResult = await searchGoogle(query, maxResults);
          break;
        case 'duckduckgo':
          searchResult = await searchDuckDuckGo(query, maxResults);
          break;
        case 'bing':
          searchResult = await searchBing(query, maxResults);
          break;
        default:
          searchResult = await searchGoogle(query, maxResults);
      }

      // Scrape the top results
      const urls = searchResult.results.map(r => r.url);
      const scrapedContent = await scrapeMultiplePages(urls);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              searchResults: searchResult,
              scrapedPages: scrapedContent,
            }, null, 2),
          },
        ],
      };
    }

    if (name === 'scrape_page_raw') {
      const { url, flatten = true, format = 'yaml' } = args as {
        url: string;
        flatten?: boolean;
        format?: 'yaml' | 'json';
      };

      const content = await scrapePageRaw(url, { flatten, format });

      // Return YAML string if format is yaml, otherwise return JSON
      const outputText = format === 'yaml' && content.yaml
        ? content.yaml
        : JSON.stringify(content, null, 2);

      return {
        content: [
          {
            type: 'text',
            text: outputText,
          },
        ],
      };
    }

    if (name === 'scrape_multiple_pages_raw') {
      const { urls, flatten = true, format = 'yaml' } = args as {
        urls: string[];
        flatten?: boolean;
        format?: 'yaml' | 'json';
      };

      const contents = await scrapeMultiplePagesRaw(urls, { flatten, format });

      // Return YAML string if format is yaml, otherwise return JSON
      if (format === 'yaml') {
        const yamlOutput = contents.map(c => `---\nurl: ${c.url}\ntitle: ${c.title}\n${c.yaml || ''}`).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: yamlOutput,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(contents, null, 2),
          },
        ],
      };
    }

    if (name === 'scrape_page_dynamic') {
      const { url, flatten = true, format = 'yaml' } = args as {
        url: string;
        flatten?: boolean;
        format?: 'yaml' | 'json';
      };

      const content = await scrapePageWithPlaywright(url, { flatten, format });

      // For YAML format: prepend stats as comment, then YAML data
      // For JSON format: include stats in the JSON object
      let outputText: string;
      if (format === 'yaml' && content.yaml) {
        const statsComment = `# Scraping Statistics
# Total items: ${content.stats?.totalItems || 0}
# - Tables/Specs: ${content.stats?.itemsByType.table || 0}
# - Text blocks: ${content.stats?.itemsByType.text || 0}
# - Images: ${content.stats?.itemsByType.image || 0}
# Estimated tokens: ${content.stats?.estimatedTokens || 0}
# Scraping time: ${content.stats?.scrapingTimeMs || 0}ms
#
`;
        outputText = statsComment + content.yaml;
      } else {
        outputText = JSON.stringify(content, null, 2);
      }

      return {
        content: [
          {
            type: 'text',
            text: outputText,
          },
        ],
      };
    }

    if (name === 'scrape_multiple_pages_dynamic') {
      const { urls, flatten = true, format = 'yaml' } = args as {
        urls: string[];
        flatten?: boolean;
        format?: 'yaml' | 'json';
      };

      const contents = await scrapeMultiplePagesWithPlaywright(urls, { flatten, format });

      if (format === 'yaml') {
        const yamlOutput = contents.map(c => `---\nurl: ${c.url}\ntitle: ${c.title}\n${c.yaml || ''}`).join('\n\n');
        return {
          content: [
            {
              type: 'text',
              text: yamlOutput,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(contents, null, 2),
          },
        ],
      };
    }

    if (name === 'download_image') {
      const { url, outputPath } = args as {
        url: string;
        outputPath?: string;
      };

      const result = await downloadImage(url, outputPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    }

    if (name === 'image_to_base64') {
      const { input } = args as {
        input: string;
      };

      const result = await imageToBase64(input);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Web Search MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
