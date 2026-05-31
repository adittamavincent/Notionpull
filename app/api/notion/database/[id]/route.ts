import { databaseTitle, NotionApiError, notionErrorResponse, notionFetch, traceChild, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const kind = new URL(request.url).searchParams.get("kind");
    const traceRoot = `database/${params.id}`;

    const isDataSource = kind === "data_source";
    const database = isDataSource
      ? await notionFetch<any>(token, `/data_sources/${params.id}`, {}, { tracePath: traceChild(traceRoot, "data-source") })
      : await notionFetch<any>(token, `/databases/${params.id}`, {}, { tracePath: traceChild(traceRoot, "database") });

    const dataSourceId = isDataSource ? database.id : (database.data_sources?.[0]?.id ?? database.id);
    const dataSourceName = isDataSource ? database.name : database.data_sources?.[0]?.name;
    
    // If it's a data source, we already have it. If it's a database, we want the source props specifically.
    // We catch any fetch errors and fall back to the container database itself.
    let dataSource: any = null;
    if (!isDataSource) {
      try {
        dataSource = await notionFetch<any>(token, `/data_sources/${dataSourceId}`, {}, { tracePath: traceChild(traceRoot, "data-source") });
      } catch {
        dataSource = database;
      }
    } else {
      dataSource = database;
    }
    
    const hasSourceProps = dataSource?.properties && Object.keys(dataSource.properties).length > 0;
    const properties = hasSourceProps ? dataSource.properties : (database.properties ?? {});
    
    return Response.json({
      id: database.id,
      title: isDataSource ? (database.name ?? "Untitled data source") : databaseTitle(database),
      dataSourceId,
      dataSourceName,
      columns: Object.keys(properties),
      properties
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
