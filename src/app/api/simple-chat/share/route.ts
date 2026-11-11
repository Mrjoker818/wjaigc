import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { execSql, isDatabaseConfigured } from "@/lib/db-client";
import { readExpectedActor } from "@/lib/expected-actor-header";
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
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const expectedActor = readExpectedActor(req.headers);
    if (expectedActor.status !== "present" || expectedActor.actorId !== user.id) {
      return NextResponse.json({ error: "登录账号已切换，请刷新后重试" }, { status: 409 });
    }
    const operation = req.headers.get("idempotency-key");
    if (!operation || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operation)) {
      return NextResponse.json({ error: "缺少有效的分享请求标识" }, { status: 400 });
    }
    const body = await req.json();
    const { conversationId, messages, title } = body as {
      conversationId?: string;
      messages?: unknown[];
      title?: string;
    };

    if (typeof conversationId !== "string" || !conversationId || conversationId.length > 200 || !Array.isArray(messages)) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    await ensureShareTable();

    // The existing primary key serializes retries, including across server instances.
    const shareId = createHash("sha256")
      .update(JSON.stringify(["simple-chat-share-v1", user.id, conversationId, operation]))
      .digest("hex").slice(0, 16);
    await execSql(
      `INSERT INTO wujie_shared_conversations (id, conversation_id, user_id, title, messages)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [shareId, conversationId, user.id, typeof title === "string" && title ? title : "分享对话", JSON.stringify(messages)]
    );
    const receipt = await execSql(
      `SELECT is_active AND (expires_at IS NULL OR expires_at > NOW()) AS available
       FROM wujie_shared_conversations WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
      [shareId, conversationId, user.id]
    );
    if (!receipt.rows[0]) {
      return NextResponse.json({ error: "无法确认分享链接" }, { status: 500 });
    }
    if (!receipt.rows[0].available) {
      return NextResponse.json({ error: "之前创建的链接已失效，可以重新创建。" }, { status: 410 });
    }

    return NextResponse.json({ shareId, shareUrl: `/shared/${shareId}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[share] 创建分享失败:", err);
    return NextResponse.json({ error: "创建分享失败" }, { status: 500 });
  }
}
