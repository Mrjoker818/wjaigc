import { NextRequest, NextResponse } from "next/server";
import {
  Document, Packer, Paragraph, TextRun,
  HeadingLevel, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType,
} from "docx";

// --- Types ---
interface WordSection {
  type: "heading" | "paragraph" | "bullet" | "table" | "divider";
  level?: number; // heading level 1-5
  text?: string;
  bold?: boolean;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
}

interface WordRequest {
  title: string;
  author?: string;
  sections: WordSection[];
}

export async function POST(request: NextRequest) {
  try {
    const body: WordRequest = await request.json();
    const { title = "文档", author = "无界AI", sections = [] } = body;

    if (!sections.length) {
      return NextResponse.json({ error: "至少需要一个内容段落" }, { status: 400 });
    }

    const children: (Paragraph | Table)[] = [];

    for (const sec of sections) {
      switch (sec.type) {
        case "heading": {
          children.push(
            new Paragraph({
              heading: (() => {
                switch (sec.level) {
                  case 1: return HeadingLevel.HEADING_1;
                  case 2: return HeadingLevel.HEADING_2;
                  case 3: return HeadingLevel.HEADING_3;
                  case 4: return HeadingLevel.HEADING_4;
                  case 5: return HeadingLevel.HEADING_5;
                  case 6: return HeadingLevel.HEADING_6;
                  default: return HeadingLevel.HEADING_2;
                }
              })(),
              text: sec.text || "",
              spacing: { before: 360, after: 200 },
            })
          );
          break;
        }
        case "paragraph": {
          const runs: TextRun[] = [];
          if (sec.bold) {
            runs.push(new TextRun({ text: sec.text || "", bold: true, size: 22 }));
          } else {
            runs.push(new TextRun({ text: sec.text || "", size: 22 }));
          }
          children.push(
            new Paragraph({
              children: runs,
              spacing: { after: 120 },
            })
          );
          break;
        }
        case "bullet": {
          if (sec.bullets?.length) {
            for (const item of sec.bullets) {
              children.push(
                new Paragraph({
                  text: item,
                  bullet: { level: 0 },
                  spacing: { after: 80 },
                })
              );
            }
          }
          break;
        }
        case "table": {
          if (sec.table) {
            const { headers, rows } = sec.table;
            const allRows: TableRow[] = [];

            if (headers.length) {
              allRows.push(
                new TableRow({
                  children: headers.map(
                    (h) =>
                      new TableCell({
                        children: [new Paragraph({
                          children: [new TextRun({ text: h, bold: true, size: 20 })],
                          alignment: AlignmentType.CENTER,
                        })],
                        width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
                        shading: { fill: "D9E2F3" },
                      })
                  ),
                })
              );
            }

            for (const row of rows) {
              allRows.push(
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        children: [new Paragraph({ text: String(cell ?? ""), spacing: { before: 40, after: 40 } })],
                        width: { size: 100 / Math.max(headers.length, row.length), type: WidthType.PERCENTAGE },
                      })
                  ),
                })
              );
            }

            children.push(
              new Table({
                rows: allRows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              })
            );
          }
          break;
        }
        case "divider": {
          children.push(
            new Paragraph({
              border: {
                bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 1 },
              },
              spacing: { before: 200, after: 200 },
            })
          );
          break;
        }
      }
    }

    const doc = new Document({
      creator: author,
      title,
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.docx"`,
      },
    });
  } catch (error) {
    console.error("[word/generate] Error:", error);
    return NextResponse.json({ error: "生成Word文档失败" }, { status: 500 });
  }
}
