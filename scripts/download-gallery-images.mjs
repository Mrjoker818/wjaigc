/**
 * Batch download gallery images from jimeng.jianying.com
 * Run: node scripts/download-gallery-images.mjs
 */
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'public/gallery/data.json');
const CACHE_DIR = path.join(process.cwd(), 'public/gallery/cache');
const CONCURRENT = 3; // concurrent downloads
const DELAY = 1000; // ms between batches

async function downloadImage(sourceUrl) {
  try {
    const resp = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!resp.ok) return null;
    const html = await resp.text();
    
    // Try og:image
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) {
      const imgUrl = ogMatch[1].replace(/&amp;/g, '&');
      const imgResp = await fetch(imgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://jimeng.jianying.com/',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (imgResp.ok && imgResp.headers.get('content-type')?.startsWith('image')) {
        return Buffer.from(await imgResp.arrayBuffer());
      }
    }

    // Try JSON data
    const jsonImgMatch = html.match(/"(https?:\/\/[^"]*(?:dreamina|toutiaoimg|byteimg)[^"]*\.(?:webp|jpg|png)[^"]*)"/);
    if (jsonImgMatch) {
      const imgUrl = jsonImgMatch[1].replace(/\\u002F/g, '/').replace(/&amp;/g, '&');
      const imgResp = await fetch(imgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://jimeng.jianying.com/',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (imgResp.ok) {
        return Buffer.from(await imgResp.arrayBuffer());
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const items = data.items.filter(i => i.sourceUrl);
  
  // Check which are already cached
  const toDownload = items.filter(item => {
    const cachePath = path.join(CACHE_DIR, item.category, `${item.id}.webp`);
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      return stat.size < 1000; // Re-download if too small
    }
    return true;
  });

  console.log(`Total: ${items.length}, Already cached: ${items.length - toDownload.length}, To download: ${toDownload.length}`);
  
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < toDownload.length; i += CONCURRENT) {
    const batch = toDownload.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const catDir = path.join(CACHE_DIR, item.category);
        if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
        const cachePath = path.join(catDir, `${item.id}.webp`);
        
        const buffer = await downloadImage(item.sourceUrl);
        if (buffer && buffer.length > 1000) {
          fs.writeFileSync(cachePath, buffer);
          return { success: true, id: item.id };
        }
        return { success: false, id: item.id };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.success) downloaded++;
        else failed++;
      } else {
        failed++;
      }
    }

    process.stdout.write(`\rProgress: ${i + batch.length}/${toDownload.length} (✓${downloaded} ✗${failed})`);
    
    if (i + CONCURRENT < toDownload.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  console.log(`\nDone! Downloaded: ${downloaded}, Failed: ${failed}`);
}

main().catch(console.error);
