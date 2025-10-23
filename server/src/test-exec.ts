const toto = async () => {
  const { scrapePageWithPlaywright } = await import(
    "./scraper-playwright-test.js"
  );
  const result = await scrapePageWithPlaywright(
    // "https://www.fnac.com/Apple-iPhone-17-Pro-Max-6-9-5G-Double-SIM-1-To-Orange-cosmique/a21960835/w-4",
    "https://www.cdiscount.com/telephonie/telephone-mobile/apple-iphone-17-pro-max-1tb-cosmic-orange/f-14404-ip17prom1torange.html",
    // "https://arh.antoinevastel.com/bots/areyouheadless",
    {}
  );
  console.log("🚀 ~ toto ~ result:", result);
};

toto();

export {};
