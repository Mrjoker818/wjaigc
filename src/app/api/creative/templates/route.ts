import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TEMPLATES = [
  {
    id: 'product-packaging',
    host: 'all',
    category: '产品包装',
    name: '产品包装主视觉',
    prompt: '为当前产品包装生成高级商业主视觉，保留产品轮廓、结构比例、品牌识别区域和包装开合逻辑，强化材质质感、灯光层次、陈列氛围和可落地的电商传播效果。',
  },
  {
    id: 'visual-merchandising',
    host: 'all',
    category: '商业美陈',
    name: '商业美陈装置',
    prompt: '基于当前画面生成商业美陈装置方案，保留空间结构与主视觉焦点，强化主题装置、产品陈列、互动打卡点、灯光层次和品牌传播记忆点。',
  },
  {
    id: 'pop-up-store',
    host: 'all',
    category: '快闪活动',
    name: '快闪店灵感渲染',
    prompt: '将当前场景升级为品牌快闪店效果图，保留原始动线、入口关系和核心模型比例，加入临时装置、互动体验、社交传播打卡点和高识别度品牌视觉。',
  },
  {
    id: 'brand-store',
    host: 'all',
    category: '品牌店',
    name: '品牌店空间渲染',
    prompt: '生成高级品牌店空间渲染，保留当前平面布局和相机视角，强化门头识别、产品陈列层级、材质真实度、商业灯光和顾客动线。',
  },
  {
    id: 'campaign-kv',
    host: 'photoshop',
    category: '活动主视觉',
    name: '活动 KV 精修',
    prompt: '将当前 Photoshop 画面精修为活动主视觉 KV，保留主体元素位置和品牌信息区域，提升画面冲击力、层次、材质、光影和社交媒体传播感。',
  },
  {
    id: 'retouch-selection',
    host: 'photoshop',
    category: '局部精修',
    name: '选区局部精修',
    prompt: '只优化当前选区内的主体细节，保持非选区区域不变，增强材质、边缘、光影和商业摄影质感。',
  },
  {
    id: 'vector-brand-extension',
    host: 'illustrator',
    category: '矢量设计',
    name: '品牌矢量延展',
    prompt: '基于当前 Illustrator 选中对象生成可编辑的品牌矢量延展方案，保留核心标识特征，扩展图形语言、辅助纹样、包装版式和活动视觉元素。',
  },
  {
    id: 'packaging-layout',
    host: 'illustrator',
    category: '包装版式',
    name: '包装平面变体',
    prompt: '基于当前包装版式生成多个商业可落地的包装平面设计变体，保留必要信息层级、品牌识别和印刷可读性。',
  },
];

export async function GET(request: NextRequest) {
  const host = request.nextUrl.searchParams.get('host') || 'all';
  const templates = TEMPLATES.filter((template) => template.host === 'all' || template.host === host);

  return NextResponse.json({
    success: true,
    source: 'creative-builtin',
    host,
    templates,
    timestamp: Date.now(),
  });
}
