import { NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';

interface FlowchartRequest {
  title: string;
  type: 'flowchart' | 'sequence' | 'class' | 'gantt' | 'architecture';
  mermaid: string;
}

function renderFlowchartHTML(title: string, mermaidCode: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: #fff; }
header { background: #1e293b; color: #fff; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
header h1 { font-size: 18px; font-weight: 600; }
header button { padding: 6px 14px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; font-size: 13px; transition: all 0.2s; }
header button:hover { background: rgba(255,255,255,0.2); }
#container { padding: 24px; display: flex; justify-content: center; align-items: flex-start; min-height: calc(100vh - 52px); }
#diagram { max-width: 100%; }
.error { color: #ef4444; padding: 40px; text-align: center; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div>
    <button onclick="exportSVG()">导出SVG</button>
    <button onclick="exportPNG()">导出PNG</button>
  </div>
</header>
<div id="container"><div id="diagram"></div></div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict' });
const code = ${JSON.stringify(mermaidCode)};
const container = document.getElementById('diagram');
// XSS 防护：错误消息文本化后再展示，避免 err.message 注入 innerHTML
function showError(prefix, err) {
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = prefix + (err && err.message ? err.message : String(err));
  container.innerHTML = '';
  container.appendChild(div);
}
try {
  mermaid.render('diagramSvg', code).then(result => {
    container.innerHTML = result.svg;
  }).catch(err => {
    showError('Mermaid 渲染错误: ', err);
  });
} catch(e) {
  showError('解析错误: ', e);
}

function exportSVG() {
  const svg = document.querySelector('#diagram svg');
  if (!svg) return alert('无SVG可导出');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml'});
  const a = document.createElement('a'); a.download = '${escapeAttr(title)}.svg'; a.href = URL.createObjectURL(blob); a.click();
}
function exportPNG() {
  const svg = document.querySelector('#diagram svg');
  if (!svg) return alert('无图像可导出');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {type: 'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const rect = svg.getBoundingClientRect();
    canvas.width = rect.width * 2; canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement('a'); a.download = '${escapeAttr(title)}.png'; a.href = canvas.toDataURL('image/png'); a.click();
  };
  img.src = url;
}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/["\\]/g, '');
}

export async function POST(request: Request) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;
  try {
    const body: FlowchartRequest = await request.json();
    const { title, mermaid } = body;

    if (!title || !mermaid) {
      return NextResponse.json({ error: '缺少必要参数: title 和 mermaid' }, { status: 400 });
    }

    const html = renderFlowchartHTML(title, mermaid);
    const buffer = Buffer.from(html, 'utf-8');

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.html"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('Flowchart generation error:', error);
    return NextResponse.json({ error: '生成流程图失败' }, { status: 500 });
  }
}
