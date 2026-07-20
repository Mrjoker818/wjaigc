import { chromium } from '@playwright/test';
import fs from 'fs';

const exe = '/root/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe });
try {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0,150)); });
  const resp = await page.goto('https://apib.ai/zh/pricing', { waitUntil: 'commit', timeout: 30000 }).catch(e => { console.log('goto err:', e.message.slice(0,150)); return null; });
  console.log('status:', resp ? resp.status() : 'none');
  await page.waitForTimeout(20000);
  const text = await page.evaluate(() => document.body ? document.body.innerText : '');
  fs.writeFileSync('/tmp/apib_rendered.txt', text);
  console.log('APIB text length:', text.length);
  await page.screenshot({ path: '/tmp/apib.png' });
} catch (e) { console.log('failed:', e.message.slice(0, 300)); }
await browser.close();
