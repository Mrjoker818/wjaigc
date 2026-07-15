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
  chartColors: string[];
}> = {
  'tech-blue': { bg: '0D1117', titleColor: '58A6FF', textColor: 'C9D1D9', accent: '1F6FEB', accentLight: '161B22', muted: '8B949E', border: '30363D', chartColors: ['58A6FF', '3FB950', 'D29922', 'F78166', 'A371F7', '8B949E'] },
  'warm-orange': { bg: '1A1410', titleColor: 'FFA657', textColor: 'E6EDF3', accent: 'D97706', accentLight: '241E18', muted: '8B949E', border: '3D362D', chartColors: ['FFA657', '58A6FF', '3FB950', 'F78166', 'A371F7', '8B949E'] },
  'clean-white': { bg: 'FFFFFF', titleColor: '1F2937', textColor: '374151', accent: '3B82F6', accentLight: 'EFF6FF', muted: '9CA3AF', border: 'E5E7EB', chartColors: ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6', '6B7280'] },
  'elegant-dark': { bg: '1A1A2E', titleColor: 'E2E2E2', textColor: 'B0B0B0', accent: '7C3AED', accentLight: '242440', muted: '6B7280', border: '2D2D44', chartColors: ['7C3AED', '06B6D4', 'F59E0B', 'EF4444', '10B981', '8B949E'] },
  'nature-green': { bg: '0D1F14', titleColor: '4ADE80', textColor: 'D1D5DB', accent: '16A34A', accentLight: '16281E', muted: '6B7280', border: '1F3D2B', chartColors: ['4ADE80', '38BDF8', 'FBBF24', 'FB923C', 'A78BFA', '8B949E'] },
  'vibrant-red': { bg: 'FFFFFF', titleColor: 'DC2626', textColor: '1F2937', accent: 'EF4444', accentLight: 'FEF2F2', muted: '9CA3AF', border: 'FEE2E2', chartColors: ['EF4444', '3B82F6', '10B981', 'F59E0B', '8B5CF6', '6B7280'] },
};

// 图表数据定义
interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut';
  title?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

// 表格数据定义
interface TableData {
  headers: string[];
  rows: string[][];
}

interface SlideData {
  title: string;
  subtitle?: string;
  content?: string;
  bullets?: string[];
  layout?: 'title' | 'content' | 'two-column' | 'bullet-list' | 'image-text' | 'quote' | 'thanks' | 'chart' | 'image' | 'table';
  speakerNotes?: string;
  // 新增字段
  chart?: ChartData;
  imageUrl?: string;
  imageCaption?: string;
  imageFull?: boolean; // 图片是否全屏（默认右侧半栏）
  table?: TableData;
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

    const PptxGenJS = (await import('pptxgenjs')).default;

    const pres = new PptxGenJS();
    pres.author = author;
    pres.title = title;
    pres.subject = title;

    pres.defineLayout({ name: 'WIDESCREEN', width: 13.33, height: 7.5 });
    pres.layout = 'WIDESCREEN';

    const t = THEMES[theme] || THEMES['tech-blue'];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const sl = pres.addSlide();
      sl.background = { color: t.bg };

      if (slide.layout !== 'thanks') {
        sl.addShape(pres.ShapeType.rect, {
          x: 0, y: 0, w: 13.33, h: 0.04,
          fill: { color: t.accent },
        });
      }

      if (slide.layout !== 'title' && slide.layout !== 'thanks') {
        sl.addText(`${i + 1} / ${slides.length}`, {
          x: 12.2, y: 7.05, w: 1, h: 0.35,
          fontSize: 8, color: t.muted, fontFace: 'Microsoft YaHei',
          align: 'right', valign: 'bottom',
        });
      }

      switch (slide.layout || 'content') {
        // ========== 基础布局（保持不变） ==========
        case 'title': {
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

        // ========== 新增：图表布局 ==========
        case 'chart': {
          sl.addText(slide.title, {
            x: 0.8, y: 0.5, w: 11.5, h: 0.8,
            fontSize: 24, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'left',
          });
          sl.addShape(pres.ShapeType.rect, {
            x: 0.8, y: 1.25, w: 1.5, h: 0.04,
            fill: { color: t.accent },
          });

          if (slide.chart) {
            const chartData = slide.chart;
            // PptxGenJS v4 CHART_NAME 类型: 'bar' | 'line' | 'pie' | 'doughnut' 等
            const chartType = (['bar', 'line', 'pie', 'doughnut'].includes(chartData.type)
              ? chartData.type
              : 'bar') as 'bar' | 'line' | 'pie' | 'doughnut';

            const chartLabels = chartData.labels || [];
            const chartSeries = (chartData.series || []).map((s) => ({
              name: s.name,
              labels: chartLabels,
              values: s.values,
            }));

            const chartOpts: Record<string, unknown> = {
              x: 0.8, y: 1.6, w: 11.5, h: 5.3,
              showLegend: chartSeries.length > 1,
              showTitle: false,
              catAxisOrientation: 'minMax' as const,
              valAxisOrientation: 'minMax' as const,
              chartColors: t.chartColors,
              dataLabelPosition: chartData.type === 'pie' || chartData.type === 'doughnut' ? 'outEnd' : undefined,
              dataLabelColor: t.textColor,
              catAxisLabelColor: t.muted,
              valAxisLabelColor: t.muted,
              catAxisLabelFontSize: 9,
              valAxisLabelFontSize: 9,
              plotArea: { fill: { color: t.accentLight } },
            };

            if (chartData.type === 'pie' || chartData.type === 'doughnut') {
              // 饼图/环形图：单系列
              const pieData = chartLabels.map((label, idx) => ({
                name: label,
                labels: [label],
                values: [chartData.series[0]?.values[idx] ?? 0],
              }));
              sl.addChart(chartType, pieData, chartOpts);
            } else {
              sl.addChart(chartType, chartSeries, chartOpts);
            }

            // 图表标题
            if (chartData.title) {
              sl.addText(chartData.title, {
                x: 0.8, y: 1.35, w: 11.5, h: 0.3,
                fontSize: 11, color: t.muted, fontFace: 'Microsoft YaHei',
                align: 'center',
              });
            }
          }
          break;
        }

        // ========== 新增：图片布局 ==========
        case 'image': {
          if (slide.imageFull) {
            // 全屏图片：标题叠加在顶部
            sl.addText(slide.title, {
              x: 0.8, y: 0.4, w: 11.5, h: 0.7,
              fontSize: 22, bold: true, color: t.titleColor,
              fontFace: 'Microsoft YaHei', align: 'left',
            });
            sl.addShape(pres.ShapeType.rect, {
              x: 0.8, y: 1.05, w: 1.5, h: 0.04,
              fill: { color: t.accent },
            });

            if (slide.imageUrl) {
              try {
                sl.addImage({
                  path: slide.imageUrl,
                  x: 0.8, y: 1.3, w: 11.5, h: 5.5,
                  sizing: { type: 'contain', w: 11.5, h: 5.5 },
                });
              } catch {
                sl.addText('[图片加载失败]', {
                  x: 0.8, y: 1.3, w: 11.5, h: 5.5,
                  fontSize: 14, color: t.muted, fontFace: 'Microsoft YaHei',
                  align: 'center', valign: 'middle',
                });
              }
            }

            if (slide.imageCaption) {
              sl.addText(slide.imageCaption, {
                x: 0.8, y: 6.9, w: 11.5, h: 0.4,
                fontSize: 10, color: t.muted, fontFace: 'Microsoft YaHei',
                align: 'center', italic: true,
              });
            }
          } else {
            // 右侧图片 + 左侧文字
            sl.addText(slide.title, {
              x: 0.8, y: 0.6, w: 6.5, h: 0.9,
              fontSize: 24, bold: true, color: t.titleColor,
              fontFace: 'Microsoft YaHei', align: 'left',
            });
            sl.addShape(pres.ShapeType.rect, {
              x: 0.8, y: 1.45, w: 1.5, h: 0.04,
              fill: { color: t.accent },
            });

            if (slide.content) {
              sl.addText(slide.content, {
                x: 0.8, y: 1.7, w: 6.5, h: 5.3,
                fontSize: 14, color: t.textColor, fontFace: 'Microsoft YaHei',
                valign: 'top',
              });
            }

            if (slide.imageUrl) {
              try {
                sl.addImage({
                  path: slide.imageUrl,
                  x: 7.8, y: 1.3, w: 4.8, h: 5.6,
                  sizing: { type: 'contain', w: 4.8, h: 5.6 },
                });
              } catch {
                sl.addText('[图片加载失败]', {
                  x: 7.8, y: 1.3, w: 4.8, h: 5.6,
                  fontSize: 12, color: t.muted, fontFace: 'Microsoft YaHei',
                  align: 'center', valign: 'middle',
                });
              }
            }

            if (slide.imageCaption) {
              sl.addText(slide.imageCaption, {
                x: 7.8, y: 6.95, w: 4.8, h: 0.35,
                fontSize: 9, color: t.muted, fontFace: 'Microsoft YaHei',
                align: 'center', italic: true,
              });
            }
          }
          break;
        }

        // ========== 新增：表格布局 ==========
        case 'table': {
          sl.addText(slide.title, {
            x: 0.8, y: 0.5, w: 11.5, h: 0.8,
            fontSize: 24, bold: true, color: t.titleColor,
            fontFace: 'Microsoft YaHei', align: 'left',
          });
          sl.addShape(pres.ShapeType.rect, {
            x: 0.8, y: 1.25, w: 1.5, h: 0.04,
            fill: { color: t.accent },
          });

          if (slide.table) {
            const headers = slide.table.headers || [];
            const rows = slide.table.rows || [];

            // 构建表头行（加粗、accent背景）
            const headerRow = headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                fontSize: 11,
                color: t.bg === 'FFFFFF' ? 'FFFFFF' : t.titleColor,
                fontFace: 'Microsoft YaHei',
                fill: { color: t.accent },
                align: 'center' as const,
                valign: 'middle' as const,
              },
            }));

            // 构建数据行（交替背景色）
            const dataRows = rows.map((row, rowIdx) =>
              row.map((cell) => ({
                text: cell,
                options: {
                  fontSize: 10,
                  color: t.textColor,
                  fontFace: 'Microsoft YaHei',
                  fill: { color: rowIdx % 2 === 0 ? t.bg : t.accentLight },
                  align: 'center' as const,
                  valign: 'middle' as const,
                },
              }))
            );

            const tableRows = [headerRow, ...dataRows];

            sl.addTable(tableRows, {
              x: 0.8, y: 1.5, w: 11.5,
              colW: headers.map(() => 11.5 / headers.length),
              rowH: [0.45, ...rows.map(() => 0.38)],
              border: { type: 'solid', pt: 0.5, color: t.border },
              autoPage: true,
            });
          }
          break;
        }

        // ========== 默认内容布局 ==========
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

      if (slide.speakerNotes) {
        sl.addNotes(slide.speakerNotes);
      }
    }

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
