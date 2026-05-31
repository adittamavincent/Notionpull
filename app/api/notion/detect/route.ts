import { blockTitle, databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    const viewId = new URL(request.url).searchParams.get("viewId");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

    // Use a smarter sequential algorithm to avoid 404/400 logs
    let targetId = id;
    let targetType: "database" | "page" | "data_source" | "block" | null = null;
    let blockData: any = null;

    try {
      // 1. Fetch as block first. This works for pages, databases, and blocks
      // without throwing 400/404 errors for type mismatches.
      blockData = await notionFetch<any>(token, `/blocks/${targetId}`);
      if (blockData.type === "child_database") {
        targetType = "database";
      } else if (blockData.type === "child_page") {
        targetType = "page";
      } else if (blockData.type === "link_to_page" && blockData.link_to_page) {
        const link = blockData.link_to_page;
        if (link.type === "database_id" && link.database_id) {
          targetType = "database";
          targetId = link.database_id;
        } else if (link.type === "page_id" && link.page_id) {
          targetType = "page";
          targetId = link.page_id;
        } else {
          targetType = "block";
        }
      } else {
        targetType = "block";
      }
    } catch (error: any) {
      if (error instanceof NotionApiError && error.status === 400) {
        // Fallback: parse error message if Notion gives us a hint
        const match = /is a (page|database|data source|data_source|block), not a/i.exec(error.message);
        if (match) {
          targetType = match[1].toLowerCase().replace(" ", "_") as any;
        } else {
          throw error;
        }
      } else if (error instanceof NotionApiError && error.status === 404) {
        // Fallback: could be a data_source since those aren't always standard blocks
      } else {
        throw error;
      }
    }

    if (!targetType) {
      try {
        const ds = await notionFetch<any>(token, `/data_sources/${targetId}`);
        return Response.json({
          type: "data_source",
          id: ds.id,
          title: ds.name ?? ds.title?.[0]?.plain_text ?? "Untitled data source",
          dataSourceId: ds.id,
          dataSourceName: ds.name,
          columns: Object.keys(ds.properties ?? {}),
          properties: ds.properties ?? {}
        });
      } catch (dsErr: any) {
        throw new Error("Object not found or no access");
      }
    }

    if (targetType === "database") {
      const database = await notionFetch<NotionDatabase>(token, `/databases/${targetId}`);
      let columns = Object.keys(database.properties ?? {});
      let selectedColumns: string[] | undefined = undefined;
      
      if (viewId) {
        try {
          const view = await notionFetch<any>(token, `/views/${viewId}`);
          if (view.configuration?.properties) {
            const propIdToName = Object.entries(database.properties ?? {}).reduce((acc: any, [name, prop]: [string, any]) => {
              acc[prop.id] = name;
              return acc;
            }, {});
            
            const viewProps = view.configuration.properties;
            const viewPropNames = viewProps.map((p: any) => propIdToName[p.property_id]).filter(Boolean);
            const viewVisibleNames = viewProps.filter((p: any) => p.visible !== false).map((p: any) => propIdToName[p.property_id]).filter(Boolean);
            
            const missing = columns.filter((c) => !viewPropNames.includes(c));
            
            columns = [...viewPropNames, ...missing];
            selectedColumns = viewVisibleNames;
          }
        } catch (err) {
          console.error("Failed to fetch view:", err);
        }
      }

      return Response.json({
        type: "database",
        id: database.id,
        title: databaseTitle(database),
        dataSourceId: database.data_sources?.[0]?.id ?? database.id,
        dataSourceName: database.data_sources?.[0]?.name,
        columns,
        selectedColumns,
        properties: database.properties ?? {}
      });
    }

    if (targetType === "page") {
      const page = await notionFetch<NotionPage>(token, `/pages/${targetId}`);
      return Response.json({ type: "page", id: page.id, title: pageTitle(page) });
    }

    if (targetType === "block") {
      return Response.json({ type: "block", id: blockData.id, title: blockTitle(blockData) || "Untitled block" });
    }

    throw new Error("Object not found or no access");
  } catch (error) {
    return notionErrorResponse(error);
  }
}

function isProbeMiss(error: unknown): boolean {
  if (!(error instanceof NotionApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && /is a (page|database|data source|data_source|block), not a (page|database|data source|data_source|block)/i.test(error.message);
}
