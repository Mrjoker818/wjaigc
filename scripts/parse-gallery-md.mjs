import fs from 'fs';
import path from 'path';

const mdPath = '/workspace/projects/assets/即梦-字体设计灵感图库-整合版.md';
const outDir = '/workspace/projects/public/gallery';
const outJson = '/workspace/projects/public/gallery/data.json';

const md = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = md.split('\n');

const categories = [];
let currentCategory = null;
let currentItems = [];
let idCounter = 0;

function flushCategory() {
  if (currentCategory && currentItems.length > 0) {
    categories.push({
      id: currentCategory.id,
      name: currentCategory.name,
      count: currentItems.length,
      items: currentItems
    });
    console.log(`  Flushed: ${currentCategory.name} -> ${currentItems.length} items`);
  }
  currentItems = [];
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  
  const catMatch = line.match(/^## (.+?) \((\d+)张\)$/);
  if (catMatch) {
    flushCategory();
    const name = catMatch[1];
    const id = 'cat-' + categories.length;
    currentCategory = { id, name };
    continue;
  }

  if (line.includes('![]') && currentCategory) {
    const rowMatch = line.match(/^\| !\[\]\(([^)]+)\) \| (.+) \|$/);
    if (rowMatch) {
      const imagePath = rowMatch[1];
      const content = rowMatch[2];
      
      let keyword = content.split('<br>')[0].trim()
        .replace(/^##\s*/, '')
        .trim();

      const sourceMatch = content.match(/\[来源\]\(([^)]+)\)/);
      const sourceUrl = sourceMatch ? sourceMatch[1] : '';
      
      // Extract display text - the main Chinese text content in quotes
      const textMatches = keyword.match(/["""]([^"""]{1,30})["""]|《([^》]{1,30})》|"([^"]{1,30})"/g);
      let displayText = '';
      if (textMatches) {
        displayText = textMatches.map(m => {
          return m.replace(/^["""《》""]+/, '').replace(/["""《》""]+$/, '');
        }).join(' ');
      }

      idCounter++;
      currentItems.push({
        id: `g${idCounter}`,
        imageFile: path.basename(imagePath),
        sourceUrl,
        prompt: keyword,
        displayText,
        category: currentCategory.id,
        categoryName: currentCategory.name
      });
    }
  }
}
flushCategory();

// Create output directory
fs.mkdirSync(outDir, { recursive: true });

const output = {
  version: '1.0',
  source: '即梦 AI字体设计灵感图库',
  totalCount: categories.reduce((sum, c) => sum + c.count, 0),
  categories: categories.map(c => ({ id: c.id, name: c.name, count: c.count })),
  items: categories.flatMap(c => c.items)
};

fs.writeFileSync(outJson, JSON.stringify(output), 'utf-8');
console.log(`\nTotal: ${output.totalCount} items across ${output.categories.length} categories`);
console.log('Categories:', output.categories.map(c => `${c.name}(${c.count})`).join(', '));
console.log(`Output: ${outJson} (${(fs.statSync(outJson).size / 1024).toFixed(0)} KB)`);
