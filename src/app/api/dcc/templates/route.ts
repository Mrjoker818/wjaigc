import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DCC_PROMPT_TEMPLATES = [
  {
    id: 'dcc-brand-store-premium',
    name: '品牌店高级商业渲染',
    category: '品牌店',
    content: '高级品牌零售店空间渲染，强化品牌门头识别与店铺记忆点，产品陈列层级清晰，材质真实高级，商业灯光精致，有适合拍照传播的顾客动线与视觉焦点。严格保留原模型布局、空间比例和当前相机视角。',
  },
  {
    id: 'dcc-pop-up-campaign',
    name: '快闪活动打卡场景',
    category: '快闪/活动',
    content: '快闪店活动场景，临时模块化装置，品牌视觉冲击强，有沉浸式互动点和社交媒体打卡点，活动灯光具有氛围感。保留原始展位结构、入口关系、参观动线和当前构图。',
  },
  {
    id: 'dcc-visual-merchandising',
    name: '商业美陈装置',
    category: '商业美陈',
    content: '商业美陈装置设计，具有季节性或主题化装饰，主视觉焦点明确，道具层次丰富，零售氛围高级，灯光精致。保留原始构图、空间结构和主要装置比例。',
  },
  {
    id: 'dcc-packaging-hero',
    name: '产品包装主视觉',
    category: '产品包装',
    content: '产品包装主视觉渲染，包装盒、瓶身、袋型或礼盒轮廓准确，标签与标识位置清晰可见，材质质感高级，商业摄影灯光柔和，有高端开箱氛围，背景干净并符合品牌调性。',
  },
  {
    id: 'dcc-product-launch-stage',
    name: '新品发布会舞台',
    category: '活动',
    content: '新品发布会舞台设计，突出主产品揭幕瞬间，品牌背景墙清晰，灯光沉浸且有仪式感，整体呈现高级发布会氛围，面向观众的构图稳定。保留原舞台结构、屏幕位置和相机角度。',
  },
  {
    id: 'dcc-exhibition-booth',
    name: '展台/路演空间',
    category: '展陈',
    content: '展台或路演空间渲染，包含品牌传播墙、接待台、产品展示区与清晰参观动线，展会灯光真实，商业展示氛围专业。保留原展台布局、结构比例和主要展示面。',
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    source: 'dcc-builtin',
    templates: DCC_PROMPT_TEMPLATES,
    timestamp: Date.now(),
  });
}
