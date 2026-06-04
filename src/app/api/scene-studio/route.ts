import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const SCENES_DIR = path.join(process.env.COZE_WORKSPACE_PATH || '/workspace/projects', 'scene-studio-data');

async function ensureDir() {
  if (!existsSync(SCENES_DIR)) {
    await mkdir(SCENES_DIR, { recursive: true });
  }
}

// GET: list scenes / get single scene
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sceneId = searchParams.get('sceneId');

    await ensureDir();

    if (sceneId) {
      const filePath = path.join(SCENES_DIR, `${sceneId}.json`);
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
      }
      const data = await readFile(filePath, 'utf-8');
      return NextResponse.json(JSON.parse(data));
    }

    const fs = await import('fs/promises');
    const files = await fs.readdir(SCENES_DIR);
    const scenes = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await readFile(path.join(SCENES_DIR, file), 'utf-8');
        const scene = JSON.parse(data);
        scenes.push({ id: scene.id, name: scene.name, updatedAt: scene.updatedAt });
      }
    }
    return NextResponse.json({ scenes });
  } catch (error) {
    console.error('[SceneStudio] GET error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: save scene / save screenshot / delete scene
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sceneId, sceneData, screenshotData } = body;

    await ensureDir();

    if (action === 'save') {
      const id = sceneId || `scene_${Date.now()}`;
      const scene = {
        id,
        ...sceneData,
        updatedAt: new Date().toISOString(),
        createdAt: sceneData?.createdAt || new Date().toISOString(),
      };
      const filePath = path.join(SCENES_DIR, `${id}.json`);
      await writeFile(filePath, JSON.stringify(scene, null, 2));
      return NextResponse.json({ success: true, sceneId: id });
    }

    if (action === 'saveScreenshot') {
      const id = sceneId || `scene_${Date.now()}`;
      if (screenshotData) {
        const base64Data = screenshotData.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filePath = path.join(SCENES_DIR, `${id}_preview.png`);
        await writeFile(filePath, buffer);
        return NextResponse.json({ success: true, previewPath: `/api/scene-studio/preview/${id}` });
      }
      return NextResponse.json({ error: 'Missing screenshot data' }, { status: 400 });
    }

    if (action === 'delete') {
      const filePath = path.join(SCENES_DIR, `${sceneId}.json`);
      if (existsSync(filePath)) {
        const { unlink } = await import('fs/promises');
        await unlink(filePath);
      }
      const previewPath = path.join(SCENES_DIR, `${sceneId}_preview.png`);
      if (existsSync(previewPath)) {
        const { unlink } = await import('fs/promises');
        await unlink(previewPath);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[SceneStudio] POST error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
