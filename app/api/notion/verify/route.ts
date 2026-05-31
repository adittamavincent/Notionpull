import { notionErrorResponse, notionFetch, traceChild, tokenFromRequest } from "@/lib/notion";

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const me: any = await notionFetch(token, "/users/me", {}, { tracePath: traceChild("verify", "users-me") });
    return Response.json({
      workspaceName: me.bot?.workspace_name ?? me.name ?? "Notion workspace",
      workspaceIcon: me.avatar_url ?? null,
      bot: { id: me.id, name: me.name, avatar_url: me.avatar_url }
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
