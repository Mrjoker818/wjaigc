import { NextRequest, NextResponse } from "next/server";
import { execSql, isDatabaseConfigured } from "@/lib/db-client";

async function ensureShareTable() {
  try {
    await execSql(`
      CREATE TABLE IF NOT EXISTS wujie_shared_conversations (
        id VARCHAR(50) PRIMARY KEY,
        conversation_id VARCHAR(200) NOT NULL,
        user_id VARCHAR(200),
        title TEXT,
        messages JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
        view_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
  } catch (err) {
    console.error("[share] 建表失败（可能已存在）:", err);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
    }

    const { shareId } = await params;
    await ensureShareTable();

    let result: Awaited<ReturnType<typeof execSql>>;
    try {
      result = await execSql(
        `SELECT id, title, messages, created_at, view_count
         FROM wujie_shared_conversations
         WHERE id = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())`,
        [shareId]
      );
    } catch (queryErr: unknown) {
      // 表不存在（42P01）时视为分享不存在
      const msg = queryErr instanceof Error ? queryErr.message : String(queryErr);
      if (msg.includes("does not exist") || msg.includes("42P01")) {
        return NextResponse.json({ error: "分享不存在或已过期" }, { status: 404 });
      }
      throw queryErr;
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "分享不存在或已过期" }, { status: 404 });
    }

    // 异步增加查看次数（不阻塞响应）
    void execSql(
      `UPDATE wujie_shared_conversations SET view_count = view_count + 1 WHERE id = $1`,
      [shareId]
    ).catch(() => {});

    const data = result.rows[0] as {
      title: string;
      messages: unknown;
      created_at: string;
      view_count: number;
    };

    return NextResponse.json({
      title: data.title,
      messages: data.messages,
      createdAt: data.created_at,
      viewCount: (data.view_count || 0) + 1,
    });
  } catch (err) {
    console.error("[share] 获取分享失败:", err);
    return NextResponse.json({ error: "获取分享失败" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
    }

    const { shareId } = await params;
    await ensureShareTable();
    await execSql(
      `UPDATE wujie_shared_conversations SET is_active = FALSE WHERE id = $1`,
      [shareId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[share] 撤销分享失败:", err);
    return NextResponse.json({ error: "撤销分享失败" }, { status: 500 });
  }
}
