import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

// --- Types ---
interface ExcelSheet {
  name?: string;
  headers?: string[];
  rows?: (string | number | boolean | null)[][];
  merges?: { start: { row: number; col: number }; end: { row: number; col: number } }[];
  colWidths?: number[];
}

interface ExcelRequest {
  title: string;
  sheets: ExcelSheet[];
}

// --- Theme presets ---
const THEME_COLORS: Record<string, { headerBg: string; headerFg: string; border: string; altRow: string }> = {
  "tech-blue":  { headerBg: "FF1F6FEB", headerFg: "FFFFFFFF", border: "FFD0D7DE", altRow: "FFF6F8FA" },
  "corp-green": { headerBg: "FF2DA44E", headerFg: "FFFFFFFF", border: "FFD0D7DE", altRow: "FFF6F8FA" },
  "warm-orange":{ headerBg: "FFD2691E", headerFg: "FFFFFFFF", border: "FFE0D6CC", altRow: "FFFFF8F2" },
  "dark-pro":   { headerBg: "FF24292F", headerFg: "FFFFFFFF", border: "FFD0D7DE", altRow: "FFF6F8FA" },
  "elegant-purple": { headerBg: "FF8250DF", headerFg: "FFFFFFFF", border: "FFD0D7DE", altRow: "FFF8F5FF" },
  "fresh-teal": { headerBg: "FF14B8A6", headerFg: "FFFFFFFF", border: "FFCCFBF1", altRow: "FFF0FDFA" },
};

export async function POST(request: NextRequest) {
  try {
    const body: ExcelRequest = await request.json();
    const { title = "工作簿", sheets = [] } = body;

    if (!sheets.length) {
      return NextResponse.json({ error: "至少需要一个工作表" }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "无界AI";
    workbook.created = new Date();

    const theme = THEME_COLORS["tech-blue"];

    for (let si = 0; si < sheets.length; si++) {
      const sheet = sheets[si];
      const ws = workbook.addWorksheet(sheet.name || `Sheet${si + 1}`, {
        properties: { tabColor: { argb: theme.headerBg } },
      });

      // Build data array
      const data: (string | number | boolean | null)[][] = [];
      if (sheet.headers?.length) data.push(sheet.headers);
      if (sheet.rows?.length) data.push(...sheet.rows);

      if (data.length === 0) continue;

      // Add rows
      data.forEach((row, ri) => {
        const r = ws.addRow(row);
        if (ri === 0 && sheet.headers?.length) {
          r.font = { bold: true, color: { argb: theme.headerFg }, size: 11 };
          r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.headerBg } };
          r.alignment = { horizontal: "center", vertical: "middle" };
        } else if (ri % 2 === 0 && data.length > 1) {
          r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.altRow } };
        }
      });

      // Column widths
      if (sheet.colWidths?.length) {
        sheet.colWidths.forEach((w, ci) => {
          if (w) ws.getColumn(ci + 1).width = w;
        });
      } else if (sheet.headers?.length) {
        sheet.headers.forEach((h, ci) => {
          ws.getColumn(ci + 1).width = Math.max(12, h.length * 2.5 + 4);
        });
      }

      // Merged cells
      if (sheet.merges?.length) {
        sheet.merges.forEach((m) => {
          ws.mergeCells(m.start.row, m.start.col, m.end.row, m.end.col);
        });
      }

      // Borders
      if (data.length > 0 && sheet.headers?.length) {
        const lastRow = data.length;
        const lastCol = sheet.headers.length;
        for (let r = 1; r <= lastRow; r++) {
          for (let c = 1; c <= lastCol; c++) {
            const cell = ws.getCell(r, c);
            cell.border = {
              top: { style: "thin", color: { argb: theme.border } },
              left: { style: "thin", color: { argb: theme.border } },
              bottom: { style: "thin", color: { argb: theme.border } },
              right: { style: "thin", color: { argb: theme.border } },
            };
          }
        }
      }

      // Auto-filter
      if (sheet.headers?.length && data.length > 1) {
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: data.length, column: sheet.headers.length },
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[excel/generate] Error:", error);
    return NextResponse.json({ error: "生成Excel失败" }, { status: 500 });
  }
}
