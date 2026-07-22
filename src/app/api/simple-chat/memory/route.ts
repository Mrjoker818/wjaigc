import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { execSql, isDatabaseConfigured } from "@/lib/db-client";
import { getSessionUser } from "@/lib/server-auth";

async function ensureMemoryTable() {
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_chat_memories (
      id VARCHAR(50) PRIMARY KEY,
      user_id VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(50) DEFAULT 'other',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await execSql(`CREATE INDEX IF NOT EXISTS idx_chat_memories_user ON wujie_chat_memories(user_id)`);
}

export async function GET(req: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ memories: [] });
    }
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    await ensureMemoryTable();
    const result = await execSql(
      `SELECT id, content, category, created_at FROM wujie_chat_memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [user.id]
    );

    return NextResponse.json({
      memories: result.rows.map(r => ({
        id: r.id,
        content: r.content,
        category: r.category,
        createdAt: new Date(r.created_at as string).getTime(),
      })),
    });
  } catch (err) {
    console.error("[memory] 获取记忆失败:", err);
    return NextResponse.json({ error: "获取记忆失败" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
    }
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const { content, category } = body as { content?: string; category?: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
    }

    await ensureMemoryTable();
    const id = randomUUID().replace(/-/g, "").slice(0, 20);
    await execSql(
      `INSERT INTO wujie_chat_memories (id, user_id, content, category) VALUES ($1, $2, $3, $4)`,
      [id, user.id, content.trim(), category || "other"]
    );

    return NextResponse.json({ id, content: content.trim(), category: category || "other" });
  } catch (err) {
    console.error("[memory] 添加记忆失败:", err);
    return NextResponse.json({ error: "添加记忆失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
    }
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
    }

    await execSql(
      `DELETE FROM wujie_chat_memories WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[memory] 删除记忆失败:", err);
    return NextResponse.json({ error: "删除记忆失败" }, { status: 500 });
  }
}
