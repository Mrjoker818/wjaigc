import { NextRequest } from 'next/server';

// PPTX 主题配色
const THEMES: Record<string, {
  bg: string;
  titleColor: string;
  textColor: string;
  accent: string;
  accentLight: string;
  muted: string;
  border: string;
}> = {
  'tech-blue': { bg: '0D1117', titleColor: '58A6FF', textColor: 'C9D1D9', accent: '1F6FEB', accentLight: '1F6FEB33', muted: '8B949E', border: '30363D' },
  'warm-orange': { bg: '1A1410', titleColor: 'FFA657', textColor: 'E6EDF3', accent: 'D97706', accentLight: 'D9770633', muted: '8B949E', border: '3D362D' },
  'clean-white': { bg: 'FFFFFF', titleColor: '1F2937', textColor: '374151', accent: '3B82F6', accentLight: 'EFF6FF', muted: '9CA3AF', border: 'E5E7EB' },
  'elegant-dark': { bg: '1A1A2E', titleColor: 'E2E2E2', textColor: 'B0B0B0', accent: '7C3AED', accentLight: '7C3AED22', muted: '6B7280', border: '2D2D44' },
  'nature-green': { bg: '0D1F14', titleColor: '4ADE80', textColor: 'D1D5DB', accent: '16A34A', accentLight: '16A34A33', muted: '6B7280', border: '1F3D2B' },
  'vibrant-red': { bg: 'FFFFFF', titleColor: 'DC2626', textColor: '1F2937', accent: 'EF4444', accentLight: 'FEF2F2', muted: '9CA3AF', border: 'FEE2E2' },
};

interface SlideData {
  title: string;
  subtitle?: string;
  content?: string;
  bullets?: string[];
  layout?: 'title' | 'content' | 'two-column' | 'bullet-list' | 'image-text' | 'quote' | 'thanks';
  speakerNotes?: string;
}

interface PptGenerateRequest {
  slides: SlideData[];
  theme?: string;
  title?: string;
  author?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PptGenerateRequest;
    const { slides = [], theme = 'tech-blue', title = '演示文稿', author = '无界AI' } = body;

    if (!slides.length) {
      return Response.json({ error: '缺少幻灯片内容' }, { status: 400 });
    }

    // 动态导入 PptxGenJS
    const PptxGenJS = (await import('pptxgenjs')).default;

    const pres = new PptxGenJS();
    pres.author = author;
    pres.title = title;
    pres.subject = title;

    // 定义布局 (16:9)
    pres.defineLayout({ name: 'WIDESCREEN', width: 13.33, height: 7.5 });
    pres.layout = 'WIDESCREEN';

    const t = THEMES[theme] || THEMES['tech-blue'];

    // 辅助函数：将 hex 转 RGB 数组
    const hexToRgb = (hex: string): [number, number, number] => {
      const v = parseInt(hex.replace('#', ''), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };

    const bgRgb = hexToRgb(t.bg);
    const accentRgb = hexToRgb(t.accent);
    const titleRgb = hexToRgb(t.titleColor);
    const textRgb = hexToRgb(t.textColor);
    const mutedRgb = hexToRgb(t.muted);
    const borderRgb = hexToRgb(t.border);

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const sl = pres.addSlide();

      // 背景色
      sl.background = { color: t.bg };

      // 顶部装饰线
      if (slide.layout !== 'thanks') {
        sl.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: 13.33, h: 0.04,
          fill: { color: t.accent },
        });
      }

      // 页码（非首页、非尾页）
      if (slide.layout !== 'title' && slide.layout !== 'thanks') {
        sl.addText(`${i + 1} / ${slides.length}`, {
          x: 12.2, y: 7.05, w: 1, h: 0.35,
          fontSize: 8, color: t.muted, fontFace: 'Microsoft YaHei',
          align: 'right', valign: 'bottom',
        });
      }

      switch (slide.layout || 'content') {
        case 'title': {
          // 封面
          sl.addShape(pres.ShapeType.rect, {
            x: 0, y: 0, w: 0.06, h: 7.5,
            fill: { color: t.accent },
          });
          sl.addText(slide.title, {
            x: 1.5, y: 2.0, w: 10.5, h: 1.8,
            fontSize: 40, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'left', valign: 'middle',
          });
          if (slide.subtitle) {
            sl.addText(slide.subtitle, {
              x: 1.5, y: 3.8, w: 10.5, h: 1.2,
              fontSize: 18, color: t.muted, fontFace: 'Microsoft YaHei',
              align: 'left', valign: 'top',
            });
          }
          // 底部横线
          sl.addShape(pres.ShapeType.rect, {
            x: 1.5, y: 5.5, w: 3, h: 0.03,
            fill: { color: t.accent },
          });
          sl.addText(author, {
            x: 1.5, y: 5.8, w: 5, h: 0.5,
            fontSize: 12, color: t.muted, fontFace: 'Microsoft YaHei',
          });
          break;
        }

        case 'bullet-list': {
          sl.addText(slide.title, {
            x: 0.8, y: 0.6, w: 11.5, h: 0.9,
            fontSize: 26, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'left',
          });
          // 标题下划线
          sl.addShape(pres.ShapeType.rect, {
            x: 0.8, y: 1.45, w: 1.5, h: 0.04,
            fill: { color: t.accent },
          });

          const items = slide.bullets || [];
          const bulletTexts = items.map((b, idx) => ({
            text: b,
            options: {
              fontSize: 15,
              color: t.textColor,
              fontFace: 'Microsoft YaHei',
              bullet: { code: '2022', color: t.accent },
              breakType: idx < items.length - 1 ? 'after' : 'none',
              paraSpaceAfter: 10,
            },
          }));

          sl.addText(bulletTexts, {
            x: 0.8, y: 1.8, w: 11.5, h: 5.2,
            valign: 'top', align: 'left',
          });
          break;
        }

        case 'two-column': {
          sl.addText(slide.title, {
            x: 0.8, y: 0.6, w: 11.5, h: 0.9,
            fontSize: 26, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei',
          });
          sl.addShape(pres.ShapeType.rect, {
            x: 0.8, y: 1.45, w: 1.5, h: 0.04,
            fill: { color: t.accent },
          });

          // 左列
          sl.addShape(pres.ShapeType.roundRect, {
            x: 0.8, y: 1.8, w: 5.5, h: 5.2,
            fill: { color: t.accentLight },
            rectRadius: 0.1,
            line: { color: t.border, width: 0.5 },
          });
          if (slide.content) {
            sl.addText(slide.content, {
              x: 1.1, y: 2.0, w: 4.9, h: 4.8,
              fontSize: 13, color: t.textColor, fontFace: 'Microsoft YaHei',
              valign: 'top',
            });
          }

          // 右列（副标题内容）
          if (slide.subtitle) {
            sl.addShape(pres.ShapeType.roundRect, {
              x: 6.8, y: 1.8, w: 5.5, h: 5.2,
              fill: { color: t.accentLight },
              rectRadius: 0.1,
              line: { color: t.border, width: 0.5 },
            });
            sl.addText(slide.subtitle, {
              x: 7.1, y: 2.0, w: 4.9, h: 4.8,
              fontSize: 13, color: t.textColor, fontFace: 'Microsoft YaHei',
              valign: 'top',
            });
          }
          break;
        }

        case 'quote': {
          sl.addShape(pres.ShapeType.rect, {
            x: 2.5, y: 2.0, w: 8.3, h: 3.5,
            fill: { color: t.accentLight },
            rectRadius: 0.15,
            line: { color: t.accent, width: 1 },
          });
          sl.addText('"', {
            x: 3.0, y: 1.8, w: 1, h: 1,
            fontSize: 48, color: t.accent, fontFace: 'Georgia',
            bold: true,
          });
          sl.addText(slide.content || slide.title, {
            x: 3.0, y: 2.5, w: 7.2, h: 2.0,
            fontSize: 20, color: t.titleColor, fontFace: 'Microsoft YaHei',
            italic: true, valign: 'middle',
          });
          if (slide.subtitle) {
            sl.addText(`— ${slide.subtitle}`, {
              x: 3.0, y: 4.6, w: 7.2, h: 0.5,
              fontSize: 12, color: t.muted, fontFace: 'Microsoft YaHei',
              align: 'right',
            });
          }
          break;
        }

        case 'thanks': {
          sl.addText('感谢聆听', {
            x: 0, y: 2.5, w: 13.33, h: 1.5,
            fontSize: 44, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'center',
          });
          sl.addShape(pres.ShapeType.rect, {
            x: 5.5, y: 4.2, w: 2.33, h: 0.03,
            fill: { color: t.accent },
          });
          sl.addText(slide.subtitle || slide.title || 'THANKS', {
            x: 0, y: 4.5, w: 13.33, h: 1,
            fontSize: 14, color: t.muted, fontFace: 'Microsoft YaHei',
            align: 'center',
          });
          break;
        }

        case 'content':
        default: {
          sl.addText(slide.title, {
            x: 0.8, y: 0.6, w: 11.5, h: 0.9,
            fontSize: 26, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'left',
          });
          sl.addShape(pres.ShapeType.rect, {
            x: 0.8, y: 1.45, w: 1.5, h: 0.04,
            fill: { color: t.accent },
          });

          if (slide.bullets && slide.bullets.length > 0) {
            const bulletTexts = slide.bullets.map((b, idx) => ({
              text: b,
              options: {
                fontSize: 15,
                color: t.textColor,
                fontFace: 'Microsoft YaHei',
                bullet: { code: '2022', color: t.accent },
                breakType: idx < slide.bullets!.length - 1 ? 'after' : 'none',
                paraSpaceAfter: 10,
              },
            }));
            sl.addText(bulletTexts, {
              x: 0.8, y: 1.8, w: 11.5, h: 5.2,
              valign: 'top',
            });
          } else if (slide.content) {
            sl.addText(slide.content, {
              x: 0.8, y: 1.8, w: 11.5, h: 5.2,
              fontSize: 15, color: t.textColor, fontFace: 'Microsoft YaHei',
              valign: 'top',
            });
          }
          break;
        }
      }

      // 演讲备注
      if (slide.speakerNotes) {
        sl.addNotes(slide.speakerNotes);
      }
    }

    // 生成 PPTX buffer
    const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer;

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.pptx"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('[ppt/generate] Error:', error);
    return Response.json(
      { error: 'PPTX 生成失败，请检查幻灯片内容格式' },
      { status: 500 }
    );
  }
}
