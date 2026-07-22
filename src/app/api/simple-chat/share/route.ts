import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { execSql, isDatabaseConfigured } from "@/lib/db-client";
import { getSessionUser } from "@/lib/server-auth";

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

export async function POST(req: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "数据库未配置，无法创建分享" }, { status: 503 });
    }

    const user = await getSessionUser(req);
    const body = await req.json();
    const { conversationId, messages, title } = body as {
      conversationId?: string;
      messages?: unknown[];
      title?: string;
    };

    if (!conversationId || !Array.isArray(messages)) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    await ensureShareTable();

    const shareId = randomUUID().replace(/-/g, "").slice(0, 16);
    await execSql(
      `INSERT INTO wujie_shared_conversations (id, conversation_id, user_id, title, messages)
       VALUES ($1, $2, $3, $4, $5)`,
      [shareId, conversationId, user?.id || null, title || "分享对话", JSON.stringify(messages)]
    );

    return NextResponse.json({ shareId, shareUrl: `/shared/${shareId}` });
  } catch (err) {
    console.error("[share] 创建分享失败:", err);
    return NextResponse.json({ error: "创建分享失败" }, { status: 500 });
  }
}
