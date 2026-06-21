import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SESSION_DIR = path.join(process.cwd(), ".notionpull_sessions");

async function ensureDir() {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (err) {}
}

function getSessionPath(username: string) {
  // Sanitize username to prevent directory traversal
  const safeName = username.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(SESSION_DIR, `${safeName}.json`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "Missing username" }, { status: 400 });
  }

  try {
    const sessionPath = getSessionPath(username);
    const data = await fs.readFile(sessionPath, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return NextResponse.json(null); // No session found
    }
    return NextResponse.json({ error: "Failed to read session" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "Missing username" }, { status: 400 });
  }

  try {
    await ensureDir();
    const body = await req.json();
    const sessionPath = getSessionPath(username);
    await fs.writeFile(sessionPath, JSON.stringify(body), "utf-8");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to save session:", err);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "Missing username" }, { status: 400 });
  }

  try {
    const sessionPath = getSessionPath(username);
    await fs.unlink(sessionPath);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return NextResponse.json({ success: true }); // Already gone
    }
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
