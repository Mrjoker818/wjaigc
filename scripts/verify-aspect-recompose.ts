import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ASPECT_RECOMPOSE_RATIOS,
  buildAspectRecomposePrompt,
  parseAspectRatio,
  recommendOppositeRatio,
  validateAspectRatioDimensions,
} from '../src/lib/aspect-recompose';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

assert.deepEqual(parseAspectRatio('9:16'), { width: 9, height: 16 });
assert.equal(recommendOppositeRatio(1920, 1080), '9:16');
assert.equal(recommendOppositeRatio(1080, 1920), '16:9');
assert.equal(recommendOppositeRatio(1024, 1024), '4:5');
assert.ok(ASPECT_RECOMPOSE_RATIOS.some((item) => item.value === '3:4'));

const prompt = buildAspectRecomposePrompt({
  targetRatio: '9:16',
  analysis: {
    summary: '品牌海报，中央产品，顶部标题，底部卖点与品牌标识',
    protectedText: ['SUMMER SALE', '50% OFF'],
    protectedElements: ['产品主体', '品牌标识', '装饰图形'],
    layout: '横版三段式信息结构',
  },
  retryFeedback: '标题必须完整可读',
});

assert.match(prompt, /9:16/);
assert.match(prompt, /元素重排|版式重构/);
assert.match(prompt, /SUMMER SALE/);
assert.match(prompt, /50% OFF/);
assert.match(prompt, /标题必须完整可读/);
assert.doesNotMatch(prompt, /扩图|补边|外扩|裁切|裁剪/);

assert.equal(validateAspectRatioDimensions(900, 1600, '9:16').valid, true);
assert.equal(validateAspectRatioDimensions(905, 1600, '9:16').valid, true);
assert.equal(validateAspectRatioDimensions(930, 1600, '9:16').valid, false);

const taskRegistry = read('src/lib/task-registry.ts');
const pollRoute = read('src/app/api/poll-task/route.ts');
const apiRoute = read('src/app/api/aspect-recompose/route.ts');
const canvas = read('src/components/infinite-canvas.tsx');
const panel = read('src/components/aspect-recompose-panel.tsx');

assert.match(taskRegistry, /'aspect-recompose'/);
assert.match(pollRoute, /aspect-recompose/);
assert.match(apiRoute, /buildAspectRecomposePrompt/);
assert.match(apiRoute, /registerTask\([^\n]+aspect-recompose/);
assert.match(apiRoute, /const maxRetries\s*=\s*1/);
assert.doesNotMatch(apiRoute, /action:\s*['"]extend['"]|outpaint/i);
assert.match(canvas, /AspectRecomposePanel/);
assert.match(canvas, /横竖重组/);
assert.match(canvas, /\/api\/aspect-recompose/);
assert.match(panel, /ASPECT_RECOMPOSE_RATIOS/);
assert.match(panel, /targetRatio/);

console.log('aspect-recompose contracts: PASS');
