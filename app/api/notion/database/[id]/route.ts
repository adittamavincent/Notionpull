import { databaseTitle, notionErrorResponse, notionFetch, traceChild, tokenFromRequest, resolveDatabaseActualTitle } from "@/lib/notion";
import type { NotionDatabase } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const kind = new URL(request.url).searchParams.get("kind");
    const viewId = new URL(request.url).searchParams.get("viewId");
    const traceRoot = `database/${params.id}`;

    const isDataSource = kind === "data_source";
    const database = isDataSource
      ? await notionFetch<any>(token, `/data_sources/${params.id}`, {}, { tracePath: traceChild(traceRoot, "data-source") })
      : await notionFetch<any>(token, `/databases/${params.id}`, {}, { tracePath: traceChild(traceRoot, "database") });

    const actualInfo = !isDataSource ? await resolveDatabaseActualTitle(token, database, traceRoot) : null;
    const dbTitle = isDataSource ? (database.name ?? "Untitled data source") : (actualInfo?.title ?? databaseTitle(database));

    let dataSourceId = isDataSource ? database.id : (actualInfo?.dataSourceId ?? database.data_sources?.[0]?.id ?? database.id);
    let dataSourceName = isDataSource ? database.name : (actualInfo?.dataSourceName ?? database.data_sources?.[0]?.name);
    let views: Array<{ id: string; title?: string; data_source_id?: string; configuration?: any }> = [];
    let activeView: any = null;
    if (!isDataSource) {
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
      } catch {
        views = [];
      }

      if (viewId) {
        activeView = views.find(v => v.id === viewId);
      }
      if (!activeView && views.length > 0) {
        activeView = views[0];
      }
      if (activeView?.data_source_id) {
        dataSourceId = activeView.data_source_id;
        dataSourceName = database.data_sources?.find((source: any) => source.id === dataSourceId)?.name ?? dataSourceName;
      }
    }
    
    // If it's a data source, we already have it. If it's a database, we want the source props specifically.
    // We catch any fetch errors and fall back to the container database itself.
    let dataSource: any = null;
    if (!isDataSource) {
      try {
        dataSource = await notionFetch<any>(token, `/data_sources/${dataSourceId}`, {}, { tracePath: traceChild(traceRoot, "data-source") });
        dataSourceName = dataSource?.name ?? dataSourceName;
      } catch {
        dataSource = database;
      }
    } else {
      dataSource = database;
    }
    
    const hasSourceProps = dataSource?.properties && Object.keys(dataSource.properties).length > 0;
    const properties = hasSourceProps ? dataSource.properties : (database.properties ?? {});
    const activeViewConfig = activeView?.configuration;
    const viewProperties = activeViewConfig?.properties ?? [];
    const propIdToName = Object.entries(properties).reduce((acc: Record<string, string>, [name, prop]: [string, any]) => {
      if (prop?.id) {
        const decodedId = decodeURIComponent(prop.id);
        acc[decodedId] = name;
        acc[prop.id] = name;
      }
      return acc;
    }, {});
    const resolvePropertyName = (entry: any): string | undefined => {
      const propertyId = entry?.property_id ?? entry?.propertyId;
      const propertyName = entry?.property_name ?? entry?.propertyName ?? entry?.name;

      if (propertyId) {
        const decodedId = decodeURIComponent(propertyId);
        if (propIdToName[decodedId]) return propIdToName[decodedId];
        if (propIdToName[propertyId]) return propIdToName[propertyId];
      }
      if (propertyName && properties[propertyName]) return propertyName;
      if (propertyName) return propertyName;
      return undefined;
    };

    const columnDetails = viewProperties.map((entry: any) => {
      const name = resolvePropertyName(entry);
      if (!name) return null;
      return {
        id: entry?.property_id ?? entry?.propertyId,
        name,
        visible: entry?.visible !== false,
        width: typeof entry?.width === "number" ? entry.width : undefined,
      };
    }).filter(Boolean) as Array<{ id?: string; name: string; visible?: boolean; width?: number }>;

    const orderedViewColumns = columnDetails.map((entry) => entry.name);
    const visibleViewColumns = columnDetails.filter((entry) => entry.visible !== false).map((entry) => entry.name);
    const columns = orderedViewColumns.length > 0
      ? [...orderedViewColumns, ...Object.keys(properties).filter((column) => !orderedViewColumns.includes(column))]
      : Object.keys(properties);
    
    const isLinkedDatabase = activeView?.data_source_id
      ? !database.data_sources?.some((ds: any) => ds.id === activeView.data_source_id)
      : (!database.data_sources || database.data_sources.length === 0);

    // Title is already resolved via actualInfo.title or database.name above.

    return Response.json({
      id: database.id,
      title: dbTitle,
      dataSourceId,
      dataSourceName,
      isLinkedDatabase,
      viewId: activeView?.id ?? viewId ?? undefined,
      views,
      activeView,
      columnDetails,
      columns,
      selectedColumns: columns,
      properties
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
