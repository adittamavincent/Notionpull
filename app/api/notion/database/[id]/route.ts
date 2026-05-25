import { databaseTitle, notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const database = await notionFetch<NotionDatabase>(token, `/databases/${params.id}`);
    const dataSourceId = database.data_sources?.[0]?.id;
    if (!dataSourceId) return Response.json({ error: "Database has no data sources" }, { status: 404 });
    return Response.json({ id: database.id, title: databaseTitle(database), dataSourceId });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
