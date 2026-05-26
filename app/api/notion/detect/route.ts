import { databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

    // Run probes in parallel for faster "detection"
    const results = await Promise.allSettled([
      notionFetch<NotionDatabase>(token, `/databases/${id}`),
      notionFetch<any>(token, `/data_sources/${id}`),
      notionFetch<NotionPage>(token, `/pages/${id}`)
    ]);

    const [dbRes, dsRes, pageRes] = results;

    if (dbRes.status === "fulfilled") {
      const database = dbRes.value;
      return Response.json({
        type: "database",
        id: database.id,
        title: databaseTitle(database),
        dataSourceId: database.data_sources?.[0]?.id,
        columns: Object.keys(database.properties ?? {}),
        properties: database.properties ?? {}
      });
    }

    if (dsRes.status === "fulfilled") {
        const dataSource = dsRes.value;
        return Response.json({
          type: "data_source",
          id: dataSource.id,
          title: dataSource.name ?? dataSource.title?.[0]?.plain_text ?? "Untitled data source",
          dataSourceId: dataSource.id,
          columns: Object.keys(dataSource.properties ?? {}),
          properties: dataSource.properties ?? {}
        });
    }

    if (pageRes.status === "fulfilled") {
        const page = pageRes.value;
        return Response.json({ type: "page", id: page.id, title: pageTitle(page) });
    }

    // If all failed, throw the first "real" error or the last error
    const firstError = [dbRes, dsRes, pageRes].find(r => r.status === "rejected" && !isProbeMiss((r as PromiseRejectedResult).reason));
    if (firstError) throw (firstError as PromiseRejectedResult).reason;

    throw new Error("Object not found or no access");
  } catch (error) {
    return notionErrorResponse(error);
  }
}

function isProbeMiss(error: unknown): boolean {
  if (!(error instanceof NotionApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && /is a (page|database|data source|data_source), not a (page|database|data source|data_source)/i.test(error.message);
}
