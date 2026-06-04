import { blockTitle, databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, traceChild, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    const viewId = new URL(request.url).searchParams.get("viewId");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    const traceRoot = `detect/${id}`;

    // Use a smarter sequential algorithm to avoid 404/400 logs
    let targetId = id;
    let targetType: "database" | "page" | "data_source" | "block" | null = null;
    let blockData: any = null;

    try {
      // 1. Fetch as block first. This works for pages, databases, and blocks
      // without throwing 400/404 errors for type mismatches.
      blockData = await notionFetch<any>(token, `/blocks/${targetId}`, {}, { tracePath: traceChild(traceRoot, "block") });
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
        const ds = await notionFetch<any>(token, `/data_sources/${targetId}`, {}, { tracePath: traceChild(traceRoot, "data-source") });
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
      const database = await notionFetch<NotionDatabase>(token, `/databases/${targetId}`, {}, { tracePath: traceChild(traceRoot, "database") });
      let dataSource: any = null;
      try {
        dataSource = await notionFetch<any>(token, `/data_sources/${database.data_sources?.[0]?.id ?? database.id}`, {}, { tracePath: traceChild(traceRoot, "data-source") });
      } catch {
        dataSource = database;
      }

      const hasSourceProps = dataSource?.properties && Object.keys(dataSource.properties).length > 0;
      const properties = hasSourceProps ? dataSource.properties : (database.properties ?? {});
      let columns = Object.keys(properties);
      let selectedColumns: string[] | undefined = undefined;
      let columnDetails: Array<{ id?: string; name: string; visible?: boolean; width?: number }> = [];
      let views: Array<{ id: string; title?: string; data_source_id?: string; configuration?: any }> = [];

      try {
        const viewList = await notionFetch<any>(token, `/views?database_id=${encodeURIComponent(database.id)}`, {}, { tracePath: traceChild(traceRoot, "views") });
        const viewIds = (viewList.results ?? []).map((view: any) => view.id).filter(Boolean);
        views = await Promise.all(viewIds.map(async (id: string) => {
          try {
            const view = await notionFetch<any>(token, `/views/${id}`, {}, { tracePath: traceChild(traceRoot, `views/${id}`) });
            const viewType = view.type;
            const configuration = view.configuration ?? (viewType && view[viewType]?.configuration) ?? view.view?.configuration;
            return {
              id: view.id,
              title: view.title ?? view.name ?? (viewType && view[viewType]?.title) ?? (viewType && view[viewType]?.name),
              data_source_id: view.data_source_id,
              configuration
            };
          } catch {
            return { id };
          }
        }));
      } catch (err) {
        console.error("Failed to list views:", err);
      }
      
      let activeView = null;
      if (viewId) {
        activeView = views.find(v => v.id === viewId);
      }
      if (!activeView && views.length > 0) {
        activeView = views[0];
      }

      const viewDataSourceId = activeView?.data_source_id;
      if (viewDataSourceId && viewDataSourceId !== (database.data_sources?.[0]?.id ?? database.id)) {
        try {
          dataSource = await notionFetch<any>(token, `/data_sources/${viewDataSourceId}`, {}, { tracePath: traceChild(traceRoot, `view-data-source/${viewDataSourceId}`) });
        } catch {
          dataSource = database;
        }
      }

      if (activeView && activeView.configuration?.properties) {
        try {
          const configuration = activeView.configuration;
          if (configuration?.properties) {
            const propIdToName = Object.entries(properties).reduce((acc: any, [name, prop]: [string, any]) => {
              acc[prop.id] = name;
              return acc;
            }, {});
            
            const viewProps = configuration.properties;
            const resolvePropertyName = (entry: any): string | undefined => {
              const propertyId = entry?.property_id ?? entry?.propertyId;
              const propertyName = entry?.property_name ?? entry?.propertyName ?? entry?.name;

              if (propertyId && propIdToName[propertyId]) return propIdToName[propertyId];
              if (propertyName && properties[propertyName]) return propertyName;
              if (propertyName) return propertyName;
              return undefined;
            };

            columnDetails = viewProps.map((entry: any) => {
              const name = resolvePropertyName(entry);
              if (!name) return null;
              return {
                id: entry?.property_id ?? entry?.propertyId,
                name,
                visible: entry?.visible !== false,
                width: typeof entry?.width === "number" ? entry.width : undefined,
              };
            }).filter(Boolean) as Array<{ id?: string; name: string; visible?: boolean; width?: number }>;

            const viewPropNames = columnDetails.map((entry) => entry.name);
            const viewVisibleNames = columnDetails.filter((entry) => entry.visible !== false).map((entry) => entry.name);
            
            const missing = columns.filter((c) => !viewPropNames.includes(c));
            
            columns = [...viewPropNames, ...missing];
            selectedColumns = viewVisibleNames.length > 0 ? viewVisibleNames : undefined;
          }
        } catch (err) {
          console.error("Failed to process view configuration:", err);
        }
      }

      return Response.json({
        type: "database",
        id: database.id,
        title: databaseTitle(database),
        dataSourceId: viewDataSourceId ?? database.data_sources?.[0]?.id ?? database.id,
        dataSourceName: dataSource?.name ?? database.data_sources?.find((source: any) => source.id === viewDataSourceId)?.name ?? database.data_sources?.[0]?.name,
        columns,
        selectedColumns,
        viewId: viewId ?? undefined,
        views,
        columnDetails,
        properties
      });
    }

    if (targetType === "page") {
      const page = await notionFetch<NotionPage>(token, `/pages/${targetId}`, {}, { tracePath: traceChild(traceRoot, "page") });
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
