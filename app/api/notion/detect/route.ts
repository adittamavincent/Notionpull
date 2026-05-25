import { databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

    try {
      const database = await notionFetch<NotionDatabase>(token, `/databases/${id}`);
      return Response.json({
        type: "database",
        id: database.id,
        title: databaseTitle(database),
        dataSourceId: database.data_sources?.[0]?.id,
        columns: Object.keys(database.properties ?? {})
      });
    } catch (error) {
      if (!isProbeMiss(error)) throw error;
    }

    try {
      const dataSource: any = await notionFetch(token, `/data_sources/${id}`);
      return Response.json({
        type: "data_source",
        id: dataSource.id,
        title: dataSource.name ?? dataSource.title?.[0]?.plain_text ?? "Untitled data source",
        dataSourceId: dataSource.id,
        columns: Object.keys(dataSource.properties ?? {})
      });
    } catch (error) {
      if (!isProbeMiss(error)) throw error;
    }

    const page = await notionFetch<NotionPage>(token, `/pages/${id}`);
    return Response.json({ type: "page", id: page.id, title: pageTitle(page) });
  } catch (error) {
    return notionErrorResponse(error);
  }
}

function isProbeMiss(error: unknown): boolean {
  if (!(error instanceof NotionApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && /is a (page|database|data source|data_source), not a (page|database|data source|data_source)/i.test(error.message);
}
