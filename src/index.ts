#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { searchGoogle, searchDuckDuckGo, searchBing, SearchEngineResult } from './searchEngines.js';
import { scrapePage, scrapeMultiplePages, PageContent } from './scraper.js';

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
        description: 'Search the web using multiple search engines (Google, DuckDuckGo, Bing) and return organic results (excluding ads). Returns up to 10 non-commercial results per engine.',
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
