import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getPublicOrigin(request?: Request): string {
  const raw = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  if (raw) {
    const domain = raw.replace(/\/+$/, '');
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  if (request && 'nextUrl' in request) {
    const url = new URL((request as Request).url);
    return url.origin;
  }
  return 'http://127.0.0.1:5000';
}

export async function GET(request: Request) {
  const baseUrl = getPublicOrigin(request);
  return NextResponse.json({
    success: true,
    service: 'wujie-dcc-ai',
    name: '无界 DCC AI 插件服务',
    version: '0.1.0',
    authRequired: false,
    endpoints: {
      health: '/api/dcc/health',
      templates: '/api/dcc/templates',
      preflight: '/api/dcc/preflight',
      generate: '/api/generate',
      pollTask: '/api/poll-task',
      ecomTemplates: '/api/ecom-templates?enabled=true',
      cloudPromptTemplates: '/api/cloud/resources?type=prompt-template',
      creativeHealth: '/api/creative/health',
      creativeTemplates: '/api/creative/templates',
      creativePhotoshop: '/api/creative/photoshop',
      creativeIllustrator: '/api/creative/illustrator',
    },
    capabilities: {
      sketchUp: true,
      threeDsMax: true,
      photoshopCep: true,
      illustratorCep: true,
      cloud: true,
      local: true,
      referenceImages: true,
      promptTemplates: true,
      ecomTemplates: true,
      creativeConnector: true,
      bearerToken: true,
      apiKey: true,
    },
    defaults: {
      baseUrl,
      referenceMode: 'composition',
      aspectRatio: '16:9',
      quality: '2K',
    },
    timestamp: Date.now(),
  });
}
