import { NextRequest, NextResponse } from 'next/server';

import {
  handleGatewaySubmission,
  submitGatewayVideo,
} from '@/lib/media-gateway/internal-client';
import { normalizeGatewayVideoRequest } from '@/lib/media-gateway/schema';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleGatewaySubmission(request, {
    mediaType: 'video',
    normalize: normalizeGatewayVideoRequest,
    submit: submitGatewayVideo,
  });
}
