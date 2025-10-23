import { chromium } from 'playwright';

async function testBrowser() {
  console.log('🚀 Starting browser test...');
  console.log('📺 Display:', process.env.DISPLAY);

  const browser = await chromium.launch({
    headless: false, // Mode avec interface graphique
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  });

  const page = await context.newPage();

  console.log('🌐 Navigating to test page...');

  // Test 1: Page de détection headless
  await page.goto('https://arh.antoinevastel.com/bots/areyouheadless');
  await page.waitForTimeout(5000);

  console.log('✅ Test page loaded');

  // Test 2: Cdiscount
  console.log('🌐 Navigating to Cdiscount...');
  await page.goto('https://www.cdiscount.com/telephonie/telephone-mobile/apple-iphone-15-pro-max-256-go-titane-noir/f-14403-app0195949045189.html');
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('📄 Page title:', title);

  // Garder le navigateur ouvert pour inspection
  console.log('⏸️  Browser kept open - Check noVNC at http://localhost:6080');
  console.log('Press Ctrl+C to close');

  // Attendre indéfiniment
  await new Promise(() => {});
}

testBrowser().catch(console.error);
