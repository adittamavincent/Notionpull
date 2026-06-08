import { databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, traceChild, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    const kind = new URL(request.url).searchParams.get("kind");
    const viewId = new URL(request.url).searchParams.get("viewId");
    const traceRoot = `datasource/${params.id}`;
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    let rows: any;
    try {
      const dataSourceId = await resolveDataSourceId(token, params.id, kind);
      rows = viewId
        ? await queryViewRows(token, viewId, body, traceChild(traceRoot, `view/${viewId}`))
        : await notionFetch<any>(token, `/data_sources/${dataSourceId}/query`, {
            method: "POST",
            body: JSON.stringify(body)
          }, { tracePath: traceChild(traceRoot, "query") });
    } catch (err: any) {
      throw err;
    }

    if (rows && Array.isArray(rows.results)) {
      rows.results = await Promise.all(rows.results.map(async (row: any) => {
        if (!row.properties || Object.keys(row.properties).length === 0 || !Object.values(row.properties).some((p: any) => p?.type === "title")) {
          try {
            return await notionFetch<any>(token, `/pages/${row.id}`, {}, { tracePath: traceChild(traceRoot, `page/${row.id}`) });
          } catch {
            return row;
          }
        }
        return row;
      }));
    }

    rows.results = await hydrateRelationTitles(token, await expandRelationProperties(token, rows.results ?? [], traceChild(traceRoot, "relations")), traceChild(traceRoot, "titles"));
    return Response.json(rows);
  } catch (error) {
    return notionErrorResponse(error);
  }
}

async function queryViewRows(token: string, viewId: string, body: Record<string, unknown>, traceRoot: string): Promise<any> {
  const createBody = { page_size: body.page_size, start_cursor: body.start_cursor };
  const created = await notionFetch<any>(token, `/views/${viewId}/queries`, {
    method: "POST",
    body: JSON.stringify(createBody)
  }, { tracePath: traceChild(traceRoot, "create-query") });

  if (Array.isArray(created?.results)) return normalizeRowsResponse(created);

  const queryId = created?.query_id ?? created?.id;
  if (!queryId) return normalizeRowsResponse(created);

  const qs = new URLSearchParams({ page_size: String(body.page_size ?? 100) });
  if (body.start_cursor) qs.set("start_cursor", String(body.start_cursor));

  const paths = [
    `/views/${viewId}/queries/${queryId}/results?${qs.toString()}`,
    `/views/${viewId}/queries/${queryId}?${qs.toString()}`
  ];

  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const results = await notionFetch<any>(token, path, {}, { tracePath: traceChild(traceRoot, "query-results") });
      return normalizeRowsResponse({ ...results, query_id: queryId, request_status: results?.request_status ?? created?.request_status });
    } catch (error) {
      lastError = error;
      if (!isProbeMiss(error)) throw error;
    }
  }
  throw lastError;
}

function normalizeRowsResponse(response: any): any {
  return {
    ...response,
    results: response?.results ?? [],
    has_more: Boolean(response?.has_more),
    next_cursor: response?.next_cursor ?? null,
  };
}

async function resolveDataSourceId(token: string, id: string, kind: string | null): Promise<string> {
  if (kind === "data_source") return id;
  if (kind === "database") {
    try {
      const database = await notionFetch<NotionDatabase>(token, `/databases/${id}`, {}, { tracePath: traceChild(`datasource/${id}`, "resolve/database") });
      return database.data_sources?.[0]?.id ?? database.id;
    } catch (error) {
      if (!isProbeMiss(error)) throw error;
      return id;
    }
  }

  const dataSource = await notionFetch<any>(token, `/data_sources/${id}`, {}, { tracePath: traceChild(`datasource/${id}`, "resolve/data-source") });
  return dataSource.id;
}

async function expandRelationProperties(token: string, rows: NotionPage[], traceRoot: string): Promise<NotionPage[]> {
  await Promise.all(rows.map(async (row) => {
    const entries = Object.entries(row.properties ?? {}).filter(([, prop]: [string, any]) => (
      prop?.type === "relation" && prop?.has_more && prop?.id
    ));

    await Promise.all(entries.map(async ([name, prop]: [string, any]) => {
      row.properties![name] = {
        ...prop,
        relation: await fetchFullRelation(token, row.id, prop.id, traceChild(traceRoot, `row/${row.id}/property/${prop.id}`)),
        has_more: false
      };
    }));
  }));

  return rows;
}

async function fetchFullRelation(token: string, pageId: string, propertyId: string, traceRoot: string): Promise<Array<{ id: string; title?: string }>> {
  const relation: Array<{ id: string; title?: string }> = [];
  let cursor: string | null = null;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const body: any = await notionFetch(token, `/pages/${pageId}/properties/${encodedPropertyId(propertyId)}?${qs.toString()}`, {}, { tracePath: traceChild(traceRoot, "relation-page") });
    relation.push(...(body.results ?? [])
      .filter((item: any) => item?.type === "relation" && item.relation?.id)
      .map((item: any) => ({ id: item.relation.id })));
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);

  return relation;
}

function encodedPropertyId(id: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(id));
  } catch {
    return encodeURIComponent(id);
  }
}

async function hydrateRelationTitles(token: string, rows: NotionPage[], traceRoot: string): Promise<NotionPage[]> {
  const relationIds = new Set<string>();

  for (const row of rows) {
    for (const prop of Object.values(row.properties ?? {})) collectRelationIds(prop, relationIds);
  }

  const titles = new Map<string, string>();
  await Promise.all(Array.from(relationIds).map(async (id) => {
    const title = await fetchObjectTitle(token, id, traceChild(traceRoot, `title/${id}`));
    if (title) titles.set(id, title);
  }));

  for (const row of rows) {
    for (const prop of Object.values(row.properties ?? {})) applyRelationTitles(prop, titles);
  }

  return rows;
}

function collectRelationIds(value: any, ids: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (value.type === "relation") {
    for (const relation of value.relation ?? []) {
      if (relation.id) ids.add(relation.id);
    }
  }
  if (value.type === "rollup" && value.rollup?.type === "array") {
    for (const item of value.rollup.array ?? []) collectRelationIds(item, ids);
  }
}

function applyRelationTitles(value: any, titles: Map<string, string>) {
  if (!value || typeof value !== "object") return;
  if (value.type === "relation") {
    value.relation = (value.relation ?? []).map((relation: any) => ({
      ...relation,
      title: titles.get(relation.id) ?? relation.title
    }));
  }
  if (value.type === "rollup" && value.rollup?.type === "array") {
    for (const item of value.rollup.array ?? []) applyRelationTitles(item, titles);
  }
}

async function fetchObjectTitle(token: string, id: string, traceRoot: string): Promise<string> {
  try {
    const page = await notionFetch<NotionPage>(token, `/pages/${id}`, {}, { tracePath: traceChild(traceRoot, "page") });
    return pageTitle(page);
  } catch (error) {
    if (!isProbeMiss(error)) return "";
  }

  try {
    const dataSource: any = await notionFetch(token, `/data_sources/${id}`, {}, { tracePath: traceChild(traceRoot, "data-source") });
    return dataSource.name ?? dataSource.title?.[0]?.plain_text ?? "Untitled data source";
  } catch (error) {
    if (!isProbeMiss(error)) return "";
  }

  try {
    const database = await notionFetch<NotionDatabase>(token, `/databases/${id}`, {}, { tracePath: traceChild(traceRoot, "database") });
    return databaseTitle(database);
  } catch {
    return "";
  }
}

function isProbeMiss(error: unknown): boolean {
  if (!(error instanceof NotionApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && /is a (page|database|data source|data_source), not a (page|database|data source|data_source)/i.test(error.message);
}
