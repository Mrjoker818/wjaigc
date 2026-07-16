import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { requireApiAuthOrReject } from '@/lib/api-auth';

const DATA_DIR = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'scene-studio-data');

/** 校验 sceneId 防止路径遍历攻击 */
function validateSceneId(sceneId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sceneId);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// GET: list scenes or get single scene
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    ensureDir();
    const { searchParams } = new URL(request.url);
    const sceneId = searchParams.get('sceneId');

    if (sceneId) {
      if (!validateSceneId(sceneId)) {
        return NextResponse.json({ error: 'Invalid sceneId' }, { status: 400 });
      }
      // Get specific scene
      const filePath = path.join(DATA_DIR, `${sceneId}.json`);
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return NextResponse.json(data);
    }

    // List all scenes
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const scenes = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
        return {
          id: data.id || f.replace('.json', ''),
          name: data.name || 'Unnamed',
          updatedAt: data.updatedAt || data.timestamp,
        };
      } catch {
        return { id: f.replace('.json', ''), name: 'Corrupted', updatedAt: null };
      }
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return NextResponse.json({ scenes });
  } catch (error) {
    console.error('[SceneStudio] GET error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: save/delete scene or screenshot
export async function POST(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    ensureDir();
    const body = await request.json();
    const { action } = body;

    if (action === 'save') {
      const { sceneData } = body;
      const sceneId = sceneData?.id || `scene_${Date.now()}`;
      if (!validateSceneId(sceneId)) {
        return NextResponse.json({ error: 'Invalid sceneId' }, { status: 400 });
      }
      const filePath = path.join(DATA_DIR, `${sceneId}.json`);
      const data = {
        id: sceneId,
        ...sceneData,
        updatedAt: Date.now(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return NextResponse.json({ success: true, sceneId });
    }

    if (action === 'saveScreenshot') {
      const { sceneId, screenshotData } = body;
      if (!sceneId || !screenshotData) {
        return NextResponse.json({ error: 'Missing sceneId or screenshotData' }, { status: 400 });
      }
      if (!validateSceneId(sceneId)) {
        return NextResponse.json({ error: 'Invalid sceneId' }, { status: 400 });
      }

      // Save screenshot as base64 data URL in the scene JSON
      const filePath = path.join(DATA_DIR, `${sceneId}.json`);
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
      }
      const sceneData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      sceneData.screenshot = screenshotData;
      sceneData.updatedAt = Date.now();
      fs.writeFileSync(filePath, JSON.stringify(sceneData, null, 2));
      return NextResponse.json({ success: true });
    }

    if (action === 'delete') {
      const { sceneId } = body;
      if (!sceneId) {
        return NextResponse.json({ error: 'Missing sceneId' }, { status: 400 });
      }
      if (!validateSceneId(sceneId)) {
        return NextResponse.json({ error: 'Invalid sceneId' }, { status: 400 });
      }
      const filePath = path.join(DATA_DIR, `${sceneId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[SceneStudio] POST error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
