import { type NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import {
  resolveSimpleChatWorkspaceHandoff,
  SimpleChatWorkspaceHandoffError,
} from '@/lib/simple-chat-workspace-handoff-server';
import { parseSimpleChatWorkspaceHandoffBody } from '@/lib/simple-chat-workspace-handoff';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const expectedActor = request.headers.get('x-wujie-expected-actor-id');
    if (expectedActor !== null && expectedActor !== user.id) {
      return NextResponse.json({ success: false, code: 'ACTOR_CHANGED' }, { status: 409 });
    }

    const body = await request.json().catch(() => null);
    const intent = parseSimpleChatWorkspaceHandoffBody(body);
    if (!intent) {
      return NextResponse.json({ success: false, code: 'INVALID_HANDOFF' }, { status: 400 });
    }

    const handoff = await resolveSimpleChatWorkspaceHandoff({ actorUserId: user.id, ...intent });
    return NextResponse.json({ success: true, handoff });
  } catch (error) {
    if (error instanceof SimpleChatWorkspaceHandoffError) {
      return NextResponse.json({ success: false, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, code: 'HANDOFF_RESOLVE_FAILED' }, { status: 500 });
  }
}
