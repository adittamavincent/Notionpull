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
  const compact = input.replace(/-/g, "");
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) throw new Error("Could not find a valid Notion ID in that URL.");
  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function plainText(richText?: NotionRichText[]): string {
  return richText?.map((part) => part.plain_text ?? "").join("") ?? "";
}

export function databaseTitle(database: NotionDatabase): string {
  return plainText(database.title) || "Untitled database";
}

export function pageTitle(page: NotionPage): string {
  const props = page.properties ?? {};
  const titleProp = Object.values(props).find((prop: any) => prop?.type === "title");
  return plainText(titleProp?.title) || "Untitled page";
}

export function propertyValue(prop: any): string {
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
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "people":
      return prop.people?.map((person: any) => person.name ?? person.id).join(", ") ?? "";
    case "files":
      return prop.files?.map((file: any) => file.name).join(", ") ?? "";
    case "relation":
      return prop.relation?.map((rel: any) => rel.id).join(", ") ?? "";
    case "rollup":
      return rollupValue(prop.rollup);
    case "formula":
      return formulaValue(prop.formula);
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

function formulaValue(formula: any): string {
  if (!formula) return "";
  if (formula.type === "date") return [formula.date?.start, formula.date?.end].filter(Boolean).join(" -> ");
  return formula[formula.type] == null ? "" : String(formula[formula.type]);
}

function rollupValue(rollup: any): string {
  if (!rollup) return "";
  if (rollup.type === "array") return rollup.array?.map(propertyValue).filter(Boolean).join(", ") ?? "";
  return rollup[rollup.type] == null ? "" : String(rollup[rollup.type]);
}

export function firstTitleProperty(page: NotionPage): string {
  return pageTitle(page);
}

export function blockTitle(block: any): string {
  if (block.type === "child_page") return block.child_page?.title ?? "Untitled page";
  if (block.type === "child_database") return block.child_database?.title ?? "Untitled database";
  return "Untitled";
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
  return ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "code", "divider", "callout"].includes(block.type);
}
