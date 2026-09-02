import type { NextRequest } from 'next/server';
import {
  GET as getAgentEditRequest,
  POST as postAgentEditRequest,
} from '@/lib/agent-runtime/agent-edit-execution-service';

export const runtime = 'nodejs';
export const maxDuration = 600;

export function POST(request: NextRequest) {
  return postAgentEditRequest(request);
}

export function GET(request: NextRequest) {
  return getAgentEditRequest(request);
}
