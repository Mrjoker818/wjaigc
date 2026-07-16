import { NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';

interface MindmapNode {
  text: string;
  children?: MindmapNode[];
}

interface MindmapRequest {
  title: string;
  root: MindmapNode;
}

function renderMindmapHTML(title: string, root: MindmapNode): string {
  const jsonData = JSON.stringify(root);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f5f5; }
header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; padding: 16px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: flex; align-items: center; justify-content: space-between; }
header h1 { font-size: 20px; font-weight: 600; }
header .actions { display: flex; gap: 8px; }
header button { padding: 6px 14px; border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; background: rgba(255,255,255,0.15); color: #fff; cursor: pointer; font-size: 13px; transition: all 0.2s; }
header button:hover { background: rgba(255,255,255,0.25); }
#mindmap { width: 100%; height: calc(100vh - 60px); }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="actions">
    <button onclick="fitView()">适应画面</button>
    <button onclick="exportPNG()">导出PNG</button>
  </div>
</header>
<svg id="mindmap"></svg>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
const data = ${jsonData};
const width = document.getElementById('mindmap').clientWidth;
const height = document.getElementById('mindmap').clientHeight;

// Color palette
const colors = ['#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#06b6d4','#3b82f6'];

const svg = d3.select('#mindmap').attr('viewBox', [-width/2, -height/2, width, height]);
const g = svg.append('g');

const tree = d3.tree().size([width * 0.8, height * 0.8]).separation((a, b) => (a.parent === b.parent ? 1 : 1.2));
const root = d3.hierarchy(data);
const treeData = tree(root);

const links = g.selectAll('.link').data(treeData.links()).enter().append('path')
  .attr('class', 'link').attr('fill', 'none').attr('stroke', '#c4b5fd').attr('stroke-width', 2)
  .attr('d', d => \`M\${d.source.y},\${d.source.x} C\${(d.source.y+d.target.y)/2},\${d.source.x} \${(d.source.y+d.target.y)/2},\${d.target.x} \${d.target.y},\${d.target.x}\`);

const nodes = g.selectAll('.node').data(treeData.descendants()).enter().append('g')
  .attr('class', 'node').attr('transform', d => \`translate(\${d.y},\${d.x})\`);

nodes.append('rect').attr('rx', 8).attr('ry', 8)
  .attr('x', d => -(d.data.text.length * 7 + 24) / 2).attr('y', -18)
  .attr('width', d => d.data.text.length * 7 + 24).attr('height', 36)
  .attr('fill', d => colors[d.depth % colors.length]).attr('opacity', 0.9);

nodes.append('text').attr('dy', 5).attr('text-anchor', 'middle')
  .text(d => d.data.text).attr('fill', '#fff').style('font-size', '14px').style('font-weight', '500');

function fitView() {
  const bounds = g.node().getBBox();
  const fullW = width, fullH = height;
  const scale = Math.min(fullW / bounds.width, fullH / bounds.height, 1.2) * 0.9;
  const tx = fullW/2 - (bounds.x + bounds.width/2) * scale;
  const ty = fullH/2 - (bounds.y + bounds.height/2) * scale;
  svg.transition().duration(500).attr('viewBox', [bounds.x - 20, bounds.y - 20, bounds.width + 40, bounds.height + 40]);
}
function exportPNG() {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(document.getElementById('mindmap'));
  const canvas = document.createElement('canvas');
  canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const blob = new Blob([svgStr], {type: 'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  img.onload = () => { ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
    const a = document.createElement('a'); a.download = '${escapeAttr(title)}.png'; a.href = canvas.toDataURL('image/png'); a.click(); };
  img.src = url;
}
window.addEventListener('resize', () => { const w = document.getElementById('mindmap').clientWidth; const h = document.getElementById('mindmap').clientHeight; svg.attr('viewBox', [-w/2, -h/2, w, h]); });
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
    const body: MindmapRequest = await request.json();
    const { title, root } = body;

    if (!title || !root || !root.text) {
      return NextResponse.json({ error: '缺少必要参数: title 和 root.text' }, { status: 400 });
    }

    const html = renderMindmapHTML(title, root);
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
    console.error('Mindmap generation error:', error);
    return NextResponse.json({ error: '生成思维导图失败' }, { status: 500 });
  }
}
