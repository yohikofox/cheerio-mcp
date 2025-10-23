import { chromium } from "rebrowser-playwright";
import * as os from "os";
import * as path from "path";

const scrapePageWithPlaywright = async (url: string, options: any) => {
  console.log("🔧 Using rebrowser-playwright with persistent context (real user profile)");

  // Utilise un profil persistant pour simuler un vrai utilisateur
  const userDataDir = path.join(os.tmpdir(), 'rebrowser-profile');
  console.log(`📁 User data directory: ${userDataDir}`);

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true, // TEST EN HEADLESS avec rebrowser-playwright
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // User agent très récent (Chrome 131)
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    // Activer JavaScript et autres features
    javaScriptEnabled: true,
    // Permissions géolocalisation
    permissions: ['geolocation'],
    geolocation: { latitude: 48.8566, longitude: 2.3522 }, // Paris
  });

  const page = browser.pages()[0] || await browser.newPage();

  try {
    console.log(`🌐 Navigating to: ${url}`);

    // Navigation avec load pour s'assurer que tout est chargé
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    console.log("✅ Page loaded (load event)");

    // Attendre un peu pour le JavaScript dynamique
    await page.waitForTimeout(3000);
    console.log("⏳ Waited 3s for dynamic content");

    // Log les erreurs de la page
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`🔴 Browser console error: ${msg.text()}`);
      }
    });

    // Vérifier l'état de la page
    const pageInfo = await page.evaluate(() => ({
      readyState: document.readyState,
      title: document.title,
      bodyLength: document.body?.innerHTML.length || 0,
      scriptsCount: document.scripts.length,
      hasBody: !!document.body,
      url: window.location.href,
    }));

    console.log("📊 Page info:", pageInfo);

    const content = await page.content();
    const title = await page.title();

    console.log(`✅ Final title: "${title}"`);
    console.log(`📄 Content length: ${content.length} chars`);

    // Debug: afficher les premiers caractères
    console.log(`📝 Content preview (first 500 chars):\n${content.substring(0, 500)}`);

    // Vérifier si on a été bloqué
    if (content.includes('Access Denied') ||
        content.includes('Blocked') ||
        content.includes('captcha') ||
        content.includes('challenge') ||
        content.length < 1000) {
      console.warn('⚠️  POSSIBLE BOT DETECTION!');
      console.warn(`   - Content length: ${content.length}`);
      console.warn(`   - Contains "Access Denied": ${content.includes('Access Denied')}`);
      console.warn(`   - Contains "Blocked": ${content.includes('Blocked')}`);
      console.warn(`   - Contains "captcha": ${content.includes('captcha')}`);
    }

    return {
      url,
      content,
      title,
      yaml: "",
    };
  } finally {
    // NE PAS FERMER le navigateur pour observer le captcha
    console.log("⏸️  Browser kept open for inspection - Press Ctrl+C to close");
    // Attendre indéfiniment
    await new Promise(() => {});
    // await browser.close(); // Commenté pour garder ouvert
  }
};

export { scrapePageWithPlaywright };
