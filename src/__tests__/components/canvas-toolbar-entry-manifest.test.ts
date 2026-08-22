import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER } from '@/lib/image-toolbar-preferences';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

const imageTools = [
  '放大', '移除背景', 'SVG智能描摹', '元素拆解', '横竖重组', '擦除', '蒙版',
  '调色', '编辑元素', '多角度', '图转3D工厂', '扩展', '裁切', '全景生成',
  '精修引擎', '人物精修大师', '语言修图', 'Agent编排', '下载',
] as const;

const videoTools = ['视频抽帧', 'AI配音', '转 GIF', '视频压缩', '下载'] as const;
const model3DTools = ['下载'] as const;

const drawerSections = {
  'ai-creation': ['图转3D工厂', '语言修图', 'Agent编排', '视频生成'],
  'brand-design': [
    '品牌电商', '精修引擎', '人物精修大师', '字境大师', '品牌工厂',
    '品牌IP设计工场', 'Logo生成器 Pro',
  ],
  'pro-tools': [
    '3D构图画布 Pro', '品牌包装系统 Pro', '3D展陈系统 Pro',
    '效果图反向拆图 Pro', 'AI PSD生成器', '表情助手',
  ],
  'canvas-tools': ['六面体', 'ChatCanvas 批注 (C)'],
} as const;

function extractDrawerSection(sectionId: string): string {
  const start = canvasSource.indexOf(`data-toolbar-drawer-section="${sectionId}"`);
  expect(start, `缺少底部工具组：${sectionId}`).toBeGreaterThanOrEqual(0);
  const next = canvasSource.indexOf('data-toolbar-drawer-section=', start + 1);
  return next === -1 ? canvasSource.slice(start) : canvasSource.slice(start, next);
}

describe('V588-UI-004 工具入口清单', () => {
  it('默认图片工具顺序覆盖每个当前图片入口且没有重复', () => {
    expect(DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER).toEqual(imageTools);
    expect(new Set(DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER).size).toBe(imageTools.length);
  });

  it('按媒体类型保留图片、视频和 3D 的精确可用入口', () => {
    const normalized = canvasSource.replace(/\s+/g, ' ');
    expect(normalized).toContain(`const imageTools = [${imageTools.map((label) => `'${label}'`).join(', ')}];`);
    expect(normalized).toContain(`const videoTools = [${videoTools.map((label) => `'${label}'`).join(', ')}];`);
    expect(normalized).toContain(`const model3DTools = [${model3DTools.map((label) => `'${label}'`).join(', ')}];`);
  });

  it.each(Object.entries(drawerSections))('保留底部抽屉 %s 的全部入口', (sectionId, labels) => {
    const section = extractDrawerSection(sectionId);
    for (const label of labels) {
      expect(section, `${sectionId} 缺少 ${label}`).toMatch(
        new RegExp(`(?:aria-label|title)="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      );
    }
  });

  it('保留底部主栏的选择、抓手、上传、生成与全部工具入口', () => {
    for (const label of ['选择工具', '抓手工具', '图片上传', '图像生成器', '全部工具']) {
      expect(canvasSource).toContain(`aria-label="${label}"`);
    }
  });
});
