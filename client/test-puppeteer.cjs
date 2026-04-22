const puppeteer = require('puppeteer');

(async () => {
  const url = 'http://localhost:5173/room/123';
  const browsers = [];
  
  for (let i = 1; i <= 10; i++) {
    console.log(`Launching browser peer ${i}...`);
    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--mute-audio'
        ]
      });
      browsers.push(browser);
      
      const page = await browser.newPage();
      await page.goto(url);
      
      console.log(`Browser peer ${i} joined successfully!`);
    } catch (err) {
      console.error(`Browser peer ${i} failed to join:`, err.message);
    }
    
    // Add a small delay between joins to not overwhelm the signal server
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log("All 10 headless browsers have joined! Keeping them alive...");
})();
