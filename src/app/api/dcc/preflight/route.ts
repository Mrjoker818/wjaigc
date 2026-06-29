import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const renderModes = [
  {
    id: 'fast-render',
    name: '快速效果图',
    description: '保留当前视角、构图和空间结构，快速生成商业效果图。',
  },
  {
    id: 'commercial-polish',
    name: '商业精修',
    description: '增强灯光、材质、陈列和品牌传播感，适合提案展示。',
  },
  {
    id: 'structure-redesign',
    name: '保结构重设计',
    description: '允许风格和材质变化，但锁定空间比例、视角和主体轮廓。',
  },
  {
    id: 'material-lighting',
    name: '材质灯光优化',
    description: '重点优化材质真实度、光影方向、表面质感和渲染氛围。',
  },
  {
    id: 'brand-retail',
    name: '品牌商业空间',
    description: '面向品牌店、美陈、快闪、展陈和活动空间的商业化生成。',
  },
  {
    id: 'multi-angle',
    name: '多角度探索',
    description: '为后续多角度和 360 全景能力预留的模式。',
  },
];

function getPublicOrigin(request?: NextRequest): string {
  const raw = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  if (raw) {
    const domain = raw.replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  if (request) return request.nextUrl.origin;
  return 'http://127.0.0.1:5000';
}

export async function GET(request: NextRequest) {
  const cloudBaseUrl = getPublicOrigin(request);
  return NextResponse.json({
    success: true,
    service: 'wujie-dcc-preflight',
    version: '0.2.0',
    endpoints: {
      health: '/api/dcc/health',
      templates: '/api/dcc/templates',
      preflight: '/api/dcc/preflight',
      generate: '/api/generate',
      pollTask: '/api/poll-task',
      creativeHealth: '/api/creative/health',
      creativeTemplates: '/api/creative/templates',
      creativePhotoshop: '/api/creative/photoshop',
      creativeIllustrator: '/api/creative/illustrator',
    },
    recommended: {
      localBaseUrl: 'http://127.0.0.1:5000',
      cloudBaseUrl,
      defaultRenderMode: 'commercial-polish',
      defaultAspectRatio: '16:9',
      defaultQuality: '2K',
      authRequiredForLocal: false,
      authRequiredForCloud: false,
    },
    capabilities: {
      localConnect: true,
      cloudConnect: true,
      referenceImageRender: true,
      promptTemplates: true,
      dccViewportCapture: true,
      taskPolling: true,
      taskHistory: true,
      photoshopEdit: true,
      illustratorVectorize: true,
      installPackagePlanned: true,
    },
    renderModes,
    checks: [
      { id: 'service', label: '服务连接', status: 'pass' },
      { id: 'templates', label: '模板接口', status: 'pass' },
      { id: 'generate', label: '生图接口', status: 'available' },
      { id: 'polling', label: '任务轮询', status: 'available' },
    ],
    timestamp: Date.now(),
  });
}
