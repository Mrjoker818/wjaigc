/**
 * Extract embedded base64 images from the gallery markdown
 * and save them as individual files in the gallery directory.
 * Also re-generates data.json with the correct local image paths.
 */
import fs from 'fs';
import path from 'path';

const MD_PATH = '/tmp/gallery-zip/即梦-字体设计灵感图库-整合版-内嵌图片.md';
const OUT_DIR = '/workspace/projects/public/gallery';
const OUT_JSON = '/workspace/projects/public/gallery/data.json';

console.log('Reading markdown file...');
const md = fs.readFileSync(MD_PATH, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = md.split('\n');
console.log(`Total lines: ${lines.length}`);

const categories = [];
let currentCategory = null;
let currentItems = [];
let idCounter = 0;
let totalImagesExtracted = 0;

function flushCategory() {
  if (currentCategory && currentItems.length > 0) {
    categories.push({
      id: currentCategory.id,
      name: currentCategory.name,
      count: currentItems.length,
      items: currentItems
    });
    console.log(`  Category: ${currentCategory.name} -> ${currentItems.length} items, ${currentItems.filter(i => i.localPath).length} images extracted`);
  }
  currentItems = [];
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  // Match category headers
  const catMatch = line.match(/^## (.+?) \((\d+)张\)$/);
  if (catMatch) {
    flushCategory();
    const name = catMatch[1];
    const id = 'cat-' + categories.length;
    currentCategory = { id, name };
    
    // Create category directory
    const catDir = path.join(OUT_DIR, id);
    if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
    continue;
  }

  // Match table rows with embedded images
  if (line.includes('![](data:') && currentCategory) {
    const rowMatch = line.match(/^\| !\[\]\((data:image\/([^;]+);base64,([^)]+))\) \| (.+) \|$/);
    if (rowMatch) {
      const mimeType = rowMatch[2]; // e.g., 'jpeg', 'png', 'webp'
      const base64Data = rowMatch[3];
      const content = rowMatch[4];
      
      // Extract keyword
      let keyword = content.split('<br>')[0].trim()
        .replace(/^##\s*/, '')
        .trim();

      const sourceMatch = content.match(/\[来源\]\(([^)]+)\)/);
      const sourceUrl = sourceMatch ? sourceMatch[1] : '';
      
      // Extract display text
      const textMatches = keyword.match(/["""]([^"""]{1,30})["""]|《([^》]{1,30})》|"([^"]{1,30})"/g);
      let displayText = '';
      if (textMatches) {
        displayText = textMatches.map(m => {
          return m.replace(/^["""《》""]+/, '').replace(/["""《》""]+$/, '');
        }).join(' ');
      }

      idCounter++;
      const itemId = `g${idCounter}`;
      
      // Determine file extension
      const ext = mimeType === 'jpeg' ? 'jpg' : mimeType === 'png' ? 'png' : 'webp';
      const fileName = `${itemId}.${ext}`;
      const catDir = path.join(OUT_DIR, currentCategory.id);
      const filePath = path.join(catDir, fileName);
      
      // Save the image
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        totalImagesExtracted++;
        
        if (totalImagesExtracted % 50 === 0) {
          console.log(`  Extracted ${totalImagesExtracted} images so far...`);
        }
      } catch (e) {
        console.error(`  Error saving image ${itemId}: ${e.message}`);
      }

      currentItems.push({
        id: itemId,
        sourceUrl,
        prompt: keyword,
        displayText,
        category: currentCategory.id,
        categoryName: currentCategory.name,
        localPath: `/gallery/${currentCategory.id}/${fileName}`
      });
    }
  }
}
flushCategory();

// Write data.json
const output = {
  version: '2.0',
  source: '即梦 AI字体设计灵感图库',
  totalCount: categories.reduce((sum, c) => sum + c.count, 0),
  totalImagesExtracted,
  categories: categories.map(c => ({ id: c.id, name: c.name, count: c.count })),
  items: categories.flatMap(c => c.items)
};

fs.writeFileSync(OUT_JSON, JSON.stringify(output), 'utf-8');

console.log(`\n=== Summary ===`);
console.log(`Total items: ${output.totalCount}`);
console.log(`Images extracted: ${totalImagesExtracted}`);
console.log(`Categories: ${categories.length}`);
categories.forEach(c => console.log(`  ${c.name}: ${c.count}`));
console.log(`Output: ${OUT_JSON} (${(fs.statSync(OUT_JSON).size / 1024).toFixed(0)} KB)`);

// Calculate total size of extracted images
let totalSize = 0;
for (const cat of categories) {
  const catDir = path.join(OUT_DIR, cat.id);
  if (fs.existsSync(catDir)) {
    const files = fs.readdirSync(catDir);
    for (const f of files) {
      totalSize += fs.statSync(path.join(catDir, f)).size;
    }
  }
}
console.log(`Total image size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
