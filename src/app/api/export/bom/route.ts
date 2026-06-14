import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      bomItems = [],
      brandName = '',
      projectName = '',
    } = body;

    if (!bomItems || bomItems.length === 0) {
      return NextResponse.json({ error: '请提供物料清单数据' }, { status: 400 });
    }

    // Generate CSV content for BOM
    const headers = ['序号', '部件名称', '数量', '材质', '工艺', '预估单价', '预估总价', '备注'];
    const rows = bomItems.map((item: Record<string, unknown>, index: number) => {
      const name = String(item.name || '');
      const count = Number(item.count || 1);
      const material = String(item.material || '');
      const craft = String(item.craft || '');
      const unitPrice = String(item.unitPrice || item.estimatedPrice || '-');
      const totalPrice = String(item.estimatedPrice || '-');
      const note = String(item.note || '');
      return [String(index + 1), name, String(count), material, craft, unitPrice, totalPrice, note];
    });

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const totalEstimate = bomItems.reduce((sum: number, item: Record<string, unknown>) => {
      return sum + (Number(item.estimatedPrice) || 0);
    }, 0);

    return NextResponse.json({
      success: true,
      csv: csvContent,
      totalEstimate,
      projectName,
      brandName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
