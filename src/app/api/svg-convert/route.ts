import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { validateApiInputs } from '@/lib/api-validator';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ConvertRequest {
  svgContent: string;
  format: 'eps' | 'dxf' | 'pdf';
  filename?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ConvertRequest;
    // 输入校验
    const _validationError = validateApiInputs(body as unknown as Record<string, unknown>, {
        imageUrl: 'optionalImageUrl'
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const { svgContent, format, filename } = body;

    if (!svgContent || !format) {
      return NextResponse.json({ success: false, error: 'Missing svgContent or format' }, { status: 400 });
    }

    if (!['eps', 'dxf', 'pdf'].includes(format)) {
      return NextResponse.json({ success: false, error: 'Unsupported format. Use eps, dxf, or pdf.' }, { status: 400 });
    }

    const tmpDir = os.tmpdir();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const svgPath = path.join(tmpDir, `svg-conv-${id}.svg`);
    const outPath = path.join(tmpDir, `svg-conv-${id}.${format}`);

    // Write SVG to temp file
    await writeFile(svgPath, svgContent, 'utf-8');

    if (format === 'eps' || format === 'pdf') {
      // Use cairosvg for EPS and PDF conversion
      const method = format === 'eps' ? 'svg2eps' : 'svg2pdf';
      const pythonScript = `
import cairosvg
import sys

with open(${JSON.stringify(svgPath)}, 'rb') as f:
    svg_data = f.read()

try:
    result = cairosvg.${method}(bytestring=svg_data)
    with open(${JSON.stringify(outPath)}, 'wb') as out:
        out.write(result)
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;
      await new Promise<void>((resolve, reject) => {
        const proc = execFile('python3', ['-c', pythonScript], { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else if (!stdout.trim().startsWith('OK')) {
            reject(new Error(stderr || 'Conversion failed'));
          } else {
            resolve();
          }
        });
        proc.stdin?.end();
      });
    } else if (format === 'dxf') {
      // Use ezdxf to create a simple DXF with the SVG as an image insert
      // Since true SVG-to-DXF path conversion is extremely complex,
      // we create a DXF that references the SVG as an underlay
      const pythonScript = `
import ezdxf
import sys

try:
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    
    # Parse SVG for viewBox to get dimensions
    import re
    with open(${JSON.stringify(svgPath)}, 'r') as f:
        svg_text = f.read()
    
    # Extract width/height
    w_match = re.search(r'width=["\\']([\\d.]+)', svg_text)
    h_match = re.search(r'height=["\\']([\\d.]+)', svg_text)
    width = float(w_match.group(1)) if w_match else 100
    height = float(h_match.group(1)) if h_match else 100
    
    # Add a border rectangle to indicate the SVG area
    msp.add_lwpolyline([
        (0, 0), (width, 0), (width, height), (0, height), (0, 0)
    ], dxfattribs={'layer': 'SVG_BORDER'})
    
    # Add text indicating this is an SVG reference
    msp.add_text(
        f'SVG Vector Image ({width}x{height})',
        dxfattribs={'insert': (width/2, height + 5), 'height': 3, 'layer': 'SVG_INFO'}
    )
    
    # Parse SVG paths and add them as polylines
    paths = re.findall(r'd="([^"]+)"', svg_text)
    for path_d in paths[:500]:  # Limit paths
        # Extract move-to and line-to coordinates
        coords = re.findall(r'[-\\d.]+', path_d)
        points = []
        for i in range(0, len(coords)-1, 2):
            try:
                x = float(coords[i])
                y = height - float(coords[i+1])  # Flip Y axis for DXF
                points.append((x, y))
            except (ValueError, IndexError):
                continue
        if len(points) >= 2:
            msp.add_lwpolyline(points, dxfattribs={'layer': 'SVG_PATHS'})
    
    doc.saveas(${JSON.stringify(outPath)})
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;
      await new Promise<void>((resolve, reject) => {
        const proc = execFile('python3', ['-c', pythonScript], { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else if (!stdout.trim().startsWith('OK')) {
            reject(new Error(stderr || 'Conversion failed'));
          } else {
            resolve();
          }
        });
        proc.stdin?.end();
      });
    }

    // Read the converted file
    const fileData = await readFile(outPath);

    // Clean up temp files
    await unlink(svgPath).catch(() => {});
    await unlink(outPath).catch(() => {});

    // Determine content type
    const contentTypes: Record<string, string> = {
      eps: 'application/postscript',
      dxf: 'application/dxf',
      pdf: 'application/pdf',
    };

    const baseName = filename || 'vector-image';
    const dispositionFilename = `${baseName}.${format}`;

    return new NextResponse(fileData, {
      status: 200,
      headers: {
        'Content-Type': contentTypes[format] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${dispositionFilename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[svg-convert] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
