import { chromium } from '@playwright/test';
import fs from 'fs';

const exe = '/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe });
const targets = process.argv[2] || 'apib';
try {
  const page = await browser.newPage();
  if (targets === 'apib') {
    await page.goto('https://apib.ai/zh/pricing', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(8000);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('/tmp/apib_rendered.txt', text);
    console.log('APIB page length:', text.length);
  } else {
    await page.goto('https://api.pearapi.ai/zh/dashboard/model-market', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(8000);
    const text = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('/tmp/pear_rendered.txt', text);
    console.log('Pear page length:', text.length);
  }
} catch (e) { console.log('render failed:', e.message.slice(0, 300)); }
await browser.close();
