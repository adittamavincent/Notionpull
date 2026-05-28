import type { NotionBlock, NotionDatabase, NotionPage, NotionRichText } from "@/types/notion";

export const NOTION_VERSION = "2026-03-11";
export const NOTION_API_BASE = "https://api.notion.com/v1";

export class NotionApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function formatNotionId(input: string): string {
  const id = extractNotionIds(input)[0];
  if (!id) throw new Error("Could not find a valid Notion ID in that URL.");
  return id;
}

export function extractNotionIds(input: string): string[] {
  if (!input) return [];

  // 1. Look for standard UUIDs (8-4-4-4-12)
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
  const uuids = input.match(uuidRegex) ?? [];

  // 2. Look for compact IDs (32 hex characters)
  const compactRegex = /[0-9a-fA-F]{32}/g;
  const compacts = input.match(compactRegex) ?? [];

  const allMatches = [...uuids, ...compacts];
  return Array.from(new Set(allMatches.map(formatCompactNotionId)));
}

function formatCompactNotionId(compactId: string): string {
  const id = compactId.replace(/-/g, "").toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function plainText(richText?: NotionRichText[]): string {
  return richText?.map((part) => part.plain_text ?? "").join("").trim() ?? "";
}

export function databaseTitle(database: NotionDatabase): string {
  return plainText(database.title) || "Untitled database";
}

export function pageTitle(page: NotionPage): string {
  const props = page.properties ?? {};
  const titleProp = Object.values(props).find((prop: any) => prop?.type === "title");
  return plainText(titleProp?.title) || "Untitled page";
}

export type PropertyValueOptions = {
  titleById?: Map<string, string> | Record<string, string>;
};

export function propertyValue(prop: any, options: PropertyValueOptions = {}): string {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return plainText(prop.title);
    case "rich_text":
      return plainText(prop.rich_text);
    case "number":
      return prop.number == null ? "" : String(prop.number);
    case "select":
      return prop.select?.name ?? "";
    case "multi_select":
      return prop.multi_select?.map((item: any) => item.name).join(", ") ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "date":
      return [prop.date?.start, prop.date?.end].filter(Boolean).join(" -> ");
    case "checkbox":
      return prop.checkbox ? "true" : "false";
    case "url":
      return titleFromUrl(prop.url, options);
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "people":
      return prop.people?.map((person: any) => person.name ?? person.id).join(", ") ?? "";
    case "files":
      return prop.files?.map((file: any) => file.name).join(", ") ?? "";
    case "relation":
      return prop.relation?.map((rel: any) => rel.title ?? titleForId(rel.id, options)).filter(Boolean).join(", ") ?? "";
    case "rollup":
      return rollupValue(prop.rollup, options);
    case "formula":
      return formulaValue(prop.formula, options);
    case "unique_id":
      return uniqueIdValue(prop.unique_id);
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "created_by":
      return prop.created_by?.name ?? prop.created_by?.id ?? "";
    case "last_edited_by":
      return prop.last_edited_by?.name ?? prop.last_edited_by?.id ?? "";
    default:
      return "";
  }
}

function uniqueIdValue(uniqueId: any): string {
  if (!uniqueId || uniqueId.number == null) return "";
  return [uniqueId.prefix, uniqueId.number].filter((part) => part != null && part !== "").join("-");
}

function formulaValue(formula: any, options: PropertyValueOptions): string {
  if (!formula) return "";
  if (formula.type === "date") return [formula.date?.start, formula.date?.end].filter(Boolean).join(" -> ");
  if (formula.type === "string") return replaceNotionUrlsWithTitles(String(formula.string ?? ""), options);
  return formula[formula.type] == null ? "" : String(formula[formula.type]);
}

function rollupValue(rollup: any, options: PropertyValueOptions): string {
  if (!rollup) return "";
  if (rollup.type === "array") return rollup.array?.map((item: any) => propertyValue(item, options)).filter(Boolean).join(", ") ?? "";
  return rollup[rollup.type] == null ? "" : String(rollup[rollup.type]);
}

export function titleForId(id: string | undefined, options: PropertyValueOptions = {}): string {
  if (!id) return "";
  const formatted = formatMaybeNotionId(id);
  const map = options.titleById;
  if (map instanceof Map) return map.get(formatted) ?? map.get(id) ?? "";
  return map?.[formatted] ?? map?.[id] ?? "";
}

function titleFromUrl(url: string | null | undefined, options: PropertyValueOptions): string {
  if (!url) return "";
  const titles = extractNotionIds(url).map((id) => titleForId(id, options)).filter(Boolean);
  return titles.join(", ");
}

function replaceNotionUrlsWithTitles(value: string, options: PropertyValueOptions): string {
  return value.replace(/https?:\/\/\S+/g, (url) => titleFromUrl(url, options));
}

function formatMaybeNotionId(id: string): string {
  const compact = id.replace(/-/g, "");
  return /^[0-9a-fA-F]{32}$/.test(compact) ? formatCompactNotionId(compact) : id;
}

export function firstTitleProperty(page: NotionPage): string {
  return pageTitle(page);
}

export function blockTitle(block: any): string {
  if (block.type === "child_page") return block.child_page?.title ?? "Untitled page";
  if (block.type === "child_database") return block.child_database?.title ?? "Untitled database";
  
  const content = block[block.type];
  if (content?.rich_text) {
    return plainText(content.rich_text);
  }
  
  if (block.type === "divider") return "Divider";
  if (block.type === "image") return "Image block";
  if (block.type === "video") return "Video block";
  if (block.type === "file") return "File block";
  if (block.type === "pdf") return "PDF block";
  if (block.type === "equation") return "Equation block";
  if (block.type === "breadcrumb") return "Breadcrumb";
  if (block.type === "table_of_contents") return "Table of Contents";
  if (block.type === "table") return "Table";
  if (block.type === "table_row") {
    const cells = block.table_row?.cells ?? [];
    return cells.map((cell: any) => plainText(cell)).filter(Boolean).join(" | ") || "Empty row";
  }
  
  return "";
}

export async function notionFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // Keep status text.
    }
    throw new NotionApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export function tokenFromRequest(request: Request): string {
  const token = request.headers.get("x-notion-token");
  if (!token) throw new NotionApiError(401, "Token invalid or expired — check your Notion token");
  return token;
}

export function notionErrorResponse(error: unknown): Response {
  if (error instanceof NotionApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected Notion error" }, { status: 500 });
}

export function isExportableBlock(block: NotionBlock): boolean {
  return ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "code", "divider", "callout", "table", "table_row"].includes(block.type);
}
