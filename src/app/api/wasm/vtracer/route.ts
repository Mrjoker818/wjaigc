import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 提供 wasm_vtracer WASM 二进制文件
 * GET /api/wasm/vtracer → 返回 .wasm 文件
 * GET /api/wasm/vtracer-base64 → 返回 base64 编码的 WASM
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const isBase64 = url.pathname.endsWith('/vtracer-base64');

  try {
    // 查找 wasm 文件
    const wasmPath = join(
      process.cwd(),
      'node_modules/wasm_vtracer/wasm_vtracer_bg.wasm'
    );

    let wasmBuffer: Buffer;
    try {
      wasmBuffer = readFileSync(wasmPath);
    } catch {
      return NextResponse.json(
        { error: 'WASM 文件未找到，请确认 wasm_vtracer 已安装' },
        { status: 404 }
      );
    }

    if (isBase64) {
      // 返回 base64 编码
      const base64 = wasmBuffer.toString('base64');
      return NextResponse.json({ data: base64, size: wasmBuffer.length });
    }

    // 直接返回 WASM 二进制
    return new NextResponse(new Uint8Array(wasmBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Length': String(wasmBuffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
