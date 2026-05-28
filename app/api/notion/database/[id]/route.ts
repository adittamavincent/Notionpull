import { databaseTitle, NotionApiError, notionErrorResponse, notionFetch, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    
    // Try as database first
    let database: any;
    let isDataSource = false;
    try {
      database = await notionFetch<NotionDatabase>(token, `/databases/${params.id}`);
    } catch (err: any) {
      if (err instanceof NotionApiError && (err.status === 404 || err.status === 400)) {
        // Try as data source
        try {
          database = await notionFetch<any>(token, `/data_sources/${params.id}`);
          isDataSource = true;
        } catch {
          throw err; // Throw original error if both fail
        }
      } else {
        throw err;
      }
    }

    const dataSourceId = isDataSource ? database.id : (database.data_sources?.[0]?.id ?? database.id);
    
    // If it's a data source, we already have it. If it's a database, we want the source props specifically.
    // We catch any fetch errors and fall back to the container database itself.
    let dataSource: any = null;
    if (!isDataSource) {
      try {
        dataSource = await notionFetch<any>(token, `/data_sources/${dataSourceId}`);
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
      columns: Object.keys(properties),
      properties
    });
  } catch (error) {
    return notionErrorResponse(error);
  }
}
