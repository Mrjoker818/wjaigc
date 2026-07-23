import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuthOrReject } from '@/lib/api-auth';
import {
  createBrandIpProject,
  getBrandIpProject,
  listBrandIpProjects,
  updateBrandIpProject,
} from '@/lib/brand-ip-storage';
import {
  type BrandIpBrief,
  type BrandIpControlledVariable,
  type BrandIpDirection,
  type BrandIpImmutableCore,
} from '@/lib/brand-ip';

export const runtime = 'nodejs';

function isAuthRejection(value: Awaited<ReturnType<typeof requireApiAuthOrReject>>): value is NextResponse {
  return value instanceof NextResponse;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();
  if (projectId) {
    const project = await getBrandIpProject(projectId, auth.userId);
    if (!project) return NextResponse.json({ error: '品牌 IP 项目不存在' }, { status: 404 });
    return NextResponse.json({ project });
  }

  const projects = await listBrandIpProjects(auth.userId);
  return NextResponse.json({ projects });
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? value as T[] : undefined;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  try {
    const body = await request.json() as Record<string, unknown>;
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (!projectId) return NextResponse.json({ error: '缺少品牌 IP 项目 ID' }, { status: 400 });

    const existing = await getBrandIpProject(projectId, auth.userId);
    if (!existing) return NextResponse.json({ error: '品牌 IP 项目不存在' }, { status: 404 });

    const confirmedDirectionId = typeof body.confirmedDirectionId === 'string'
      ? body.confirmedDirectionId.trim()
      : body.confirmedDirectionId === null
        ? null
        : undefined;
    if (confirmedDirectionId && !existing.directions.some((direction: BrandIpDirection) => direction.id === confirmedDirectionId)) {
      return NextResponse.json({ error: '确认的角色方向不属于当前项目' }, { status: 400 });
    }

    const project = await updateBrandIpProject(projectId, auth.userId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      brief: readObject(body.brief) as BrandIpBrief | undefined,
      directions: readArray<BrandIpDirection>(body.directions),
      confirmedDirectionId,
      immutableCore: readArray<BrandIpImmutableCore>(body.immutableCore),
      controlledVariables: readArray<BrandIpControlledVariable>(body.controlledVariables),
    });
    if (!project) return NextResponse.json({ error: '品牌 IP 项目不存在' }, { status: 404 });

    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: '品牌 IP 项目更新失败' }, { status: 400 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiAuthOrReject(request);
  if (isAuthRejection(auth)) return auth;

  try {
    const body = await request.json() as { name?: unknown; brief?: unknown };
    const project = await createBrandIpProject(auth.userId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      brief: typeof body.brief === 'object' && body.brief !== null
        ? body.brief as Record<string, unknown>
        : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '品牌 IP 项目创建失败' }, { status: 400 });
  }
}
