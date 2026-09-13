import { NextRequest, NextResponse } from 'next/server';

import {
  handleGatewaySubmission,
  submitGatewayImage,
} from '@/lib/media-gateway/internal-client';
import { normalizeGatewayImageRequest } from '@/lib/media-gateway/schema';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleGatewaySubmission(request, {
    mediaType: 'image',
    normalize: normalizeGatewayImageRequest,
    submit: submitGatewayImage,
  });
}
