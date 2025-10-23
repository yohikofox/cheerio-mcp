import { chromium } from 'playwright-core';
import * as cheerio from 'cheerio';

const url = 'https://www.darty.com/nav/achat/telephonie/telephone_mobile_seul/iphone/apple_iph17pm_1to_ora.html';

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  console.log(`Fetching: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const html = await page.content();
  const $ = cheerio.load(html);

  console.log('\n=== STRUCTURE ANALYSIS ===\n');

  // Analyze navigation elements
  console.log('Navigation elements:');
  $('nav, [role="navigation"], .navigation, .nav, .menu').each((i, el) => {
    const text = $(el).text().trim().substring(0, 100);
    const classes = $(el).attr('class') || '';
    const id = $(el).attr('id') || '';
    console.log(`  - [${el.tagName}] id="${id}" class="${classes}" → ${text}...`);
  });

  // Analyze header/footer
  console.log('\nHeader/Footer elements:');
  $('header, footer, [role="banner"], [role="contentinfo"]').each((i, el) => {
    const text = $(el).text().trim().substring(0, 100);
    const classes = $(el).attr('class') || '';
    console.log(`  - [${el.tagName}] class="${classes}" → ${text}...`);
  });

  // Analyze links with common noise patterns
  console.log('\nLinks analysis (potential noise):');
  const noisePatterns = ['aide', 'contact', 'à propos', 'app', 'télécharg', 'service client', 'informations'];
  $('a').each((i, el) => {
    const text = $(el).text().trim().toLowerCase();
    const href = $(el).attr('href') || '';
    if (noisePatterns.some(pattern => text.includes(pattern))) {
      console.log(`  - "${text}" → ${href}`);
    }
  });

  // Analyze main content area
  console.log('\nMain content indicators:');
  $('main, [role="main"], .product, .content, article').each((i, el) => {
    const classes = $(el).attr('class') || '';
    const id = $(el).attr('id') || '';
    console.log(`  - [${el.tagName}] id="${id}" class="${classes}"`);
  });

  // Analyze data attributes that might indicate product info
  console.log('\nElements with data-* attributes (structured data):');
  $('[data-product], [data-price], [data-name], [itemprop], [itemtype]').slice(0, 10).each((i, el) => {
    const attrs = {};
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith('data-') || attr.startsWith('item')) {
        attrs[attr] = el.attribs[attr];
      }
    }
    console.log(`  - [${el.tagName}]`, attrs);
  });

  // Sample text nodes to identify patterns
  console.log('\nText content analysis (first 20 text blocks):');
  const textBlocks = [];
  $('*').each((i, el) => {
    const $el = $(el);
    const directText = $el.contents()
      .filter((i, node) => node.type === 'text')
      .text()
      .trim();
    if (directText && directText.length > 5) {
      textBlocks.push({
        tag: el.tagName,
        class: $el.attr('class') || '',
        text: directText.substring(0, 60)
      });
    }
  });

  textBlocks.slice(0, 20).forEach(block => {
    console.log(`  - <${block.tag}${block.class ? ` class="${block.class}"` : ''}> "${block.text}..."`);
  });

  await browser.close();
})();
