import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../../../../Report/Master Thesis - Draft/figures');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('Generating Thesis Figures via Puppeteer...');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1200, height: 800, deviceScaleFactor: 4 }, // High res
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    await page.goto('http://localhost:5174/thesis-figures', { waitUntil: 'networkidle0' });
  } catch (e) {
    console.error('Failed to load http://localhost:5174/thesis-figures. Is the dev server running?');
    process.exit(1);
  }

  // Get all figures
  const figures = await page.$$('[data-figure]');
  
  console.log(`Found ${figures.length} figures on page.`);

  for (const handle of figures) {
    const figName = await handle.evaluate(el => el.getAttribute('data-figure'));
    if (!figName) continue;
    
    const outPath = path.join(outDir, `${figName}.png`);
    await handle.screenshot({ path: outPath, type: 'png', omitBackground: true });
    console.log(`Saved ${outPath}`);
  }

  await browser.close();
  console.log('Generation complete.');
})();
