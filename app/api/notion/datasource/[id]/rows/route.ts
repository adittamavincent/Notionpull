import { databaseTitle, notionErrorResponse, notionFetch, NotionApiError, pageTitle, tokenFromRequest } from "@/lib/notion";
import type { NotionDatabase, NotionPage } from "@/types/notion";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const token = tokenFromRequest(request);
    const cursor = new URL(request.url).searchParams.get("cursor");
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    let rows: any;
    try {
      rows = await notionFetch<any>(token, `/data_sources/${params.id}/query`, {
        method: "POST",
        body: JSON.stringify(body)
      });
    } catch (err: any) {
      if (err instanceof NotionApiError && (err.status === 404 || err.status === 400)) {
        try {
          rows = await notionFetch<any>(token, `/databases/${params.id}/query`, {
            method: "POST",
            body: JSON.stringify(body)
          });
        } catch {
          throw err; // Throw original error if both fail
        }
      } else {
        throw err;
      }
    }
    rows.results = await hydrateRelationTitles(token, await expandRelationProperties(token, rows.results ?? []));
    return Response.json(rows);
  } catch (error) {
    return notionErrorResponse(error);
  }
}

async function expandRelationProperties(token: string, rows: NotionPage[]): Promise<NotionPage[]> {
  await Promise.all(rows.map(async (row) => {
    const entries = Object.entries(row.properties ?? {}).filter(([, prop]: [string, any]) => (
      prop?.type === "relation" && prop?.has_more && prop?.id
    ));

    await Promise.all(entries.map(async ([name, prop]: [string, any]) => {
      row.properties![name] = {
        ...prop,
        relation: await fetchFullRelation(token, row.id, prop.id),
        has_more: false
      };
    }));
  }));

  return rows;
}

async function fetchFullRelation(token: string, pageId: string, propertyId: string): Promise<Array<{ id: string; title?: string }>> {
  const relation: Array<{ id: string; title?: string }> = [];
  let cursor: string | null = null;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const body: any = await notionFetch(token, `/pages/${pageId}/properties/${encodedPropertyId(propertyId)}?${qs.toString()}`);
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

async function hydrateRelationTitles(token: string, rows: NotionPage[]): Promise<NotionPage[]> {
  const relationIds = new Set<string>();

  for (const row of rows) {
    for (const prop of Object.values(row.properties ?? {})) collectRelationIds(prop, relationIds);
  }

  const titles = new Map<string, string>();
  await Promise.all(Array.from(relationIds).map(async (id) => {
    const title = await fetchObjectTitle(token, id);
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

async function fetchObjectTitle(token: string, id: string): Promise<string> {
  try {
    const database = await notionFetch<NotionDatabase>(token, `/databases/${id}`);
    return databaseTitle(database);
  } catch (error) {
    if (!isProbeMiss(error)) return "";
  }

  try {
    const dataSource: any = await notionFetch(token, `/data_sources/${id}`);
    return dataSource.name ?? dataSource.title?.[0]?.plain_text ?? "Untitled data source";
  } catch (error) {
    if (!isProbeMiss(error)) return "";
  }

  try {
    const page = await notionFetch<NotionPage>(token, `/pages/${id}`);
    return pageTitle(page);
  } catch {
    return "";
  }
}

function isProbeMiss(error: unknown): boolean {
  if (!(error instanceof NotionApiError)) return false;
  if (error.status === 404) return true;
  return error.status === 400 && /is a (page|database|data source|data_source), not a (page|database|data source|data_source)/i.test(error.message);
}
