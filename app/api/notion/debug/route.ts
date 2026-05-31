import { getLogs, clearLogs } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getLogs());
}

export async function DELETE() {
  clearLogs();
  return Response.json({ success: true });
}
