import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
    service: 'wujie-creative-connector',
    name: '无界创意连接器',
    version: '0.1.0',
    route: 'cep',
    authRequired: false,
    hosts: {
      photoshopCep: true,
      illustratorCep: true,
      sketchUp: true,
      threeDsMax: true,
      windowsCapture: true,
    },
    endpoints: {
      health: '/api/creative/health',
      templates: '/api/creative/templates',
      photoshop: '/api/creative/photoshop',
      illustrator: '/api/creative/illustrator',
      dccHealth: '/api/dcc/health',
      dccTemplates: '/api/dcc/templates',
      dccPreflight: '/api/dcc/preflight',
      generate: '/api/generate',
      imageEdit: '/api/image-edit',
      vectorize: '/api/design/vectorize',
      svgTrace: '/api/svg-trace',
      segmentElements: '/api/segment-elements',
    },
    capabilities: {
      generateFromReference: true,
      imageToImage: true,
      editWithMask: true,
      inpaint: true,
      removeBackground: true,
      upscale: true,
      vectorize: true,
      svgTrace: true,
      psdLayering: true,
      layerDecompose: true,
      localAndCloud: true,
      chineseTemplates: true,
    },
    defaults: {
      localBaseUrl: 'http://127.0.0.1:5000',
      cloudBaseUrl,
      aspectRatio: '16:9',
      quality: '2K',
    },
    timestamp: Date.now(),
  });
}
