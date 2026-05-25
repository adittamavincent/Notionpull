import type { NotionBlock, NotionPage } from "@/types/notion";
import { propertyValue, type PropertyValueOptions } from "@/lib/notion";

export type DatabaseExportItem = { kind: "database" | "data_source"; title: string; rows: NotionPage[]; columns?: string[]; selectedColumns?: string[] };
export type PageExportItem = { kind: "page" | "row"; title: string; page?: NotionPage; blocks?: NotionBlock[] };
export type ExportItem = DatabaseExportItem | PageExportItem;

export type ExportOptions = PropertyValueOptions;

export function exportMarkdown(items: ExportItem[], options: ExportOptions = {}): string {
  return items.map((item) => {
    if (isDatabaseItem(item)) {
      return databaseToMarkdown(item, options);
    }
    const heading = `# ${item.title}`;
    const properties = item.page ? pagePropertiesToMarkdown(item.page, options) : "";
    const blocks = item.blocks?.map(blockToMarkdown).filter(Boolean).join("\n") ?? "";
    return [heading, properties, blocks].filter(Boolean).join("\n\n");
  }).join("\n\n---\n\n");
}

export function exportCsv(items: ExportItem[], options: ExportOptions = {}): string {
  return items.map((item) => {
    if (isDatabaseItem(item)) {
      return databaseToCsv(item, options);
    }
    const rows = [["property", "value"]];
    if (item.page?.properties) {
      for (const [name, prop] of Object.entries(item.page.properties)) rows.push([name, propertyValue(prop, options)]);
    } else {
      rows.push(["title", item.title]);
    }
    return `# ${item.title}\n${rows.map(csvRow).join("\n")}`;
  }).join("\n\n");
}

function isDatabaseItem(item: ExportItem): item is DatabaseExportItem {
  return item.kind === "database" || item.kind === "data_source";
}

function databaseToMarkdown(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  const head = [`## ${item.title}`];
  if (!columns.length) return `${head[0]}\n\n_No columns._`;
  head.push(`| ${columns.map(escapeMarkdown).join(" | ")} |`);
  head.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of item.rows) {
    head.push(`| ${columns.map((column) => escapeMarkdown(propertyValue(row.properties?.[column], options))).join(" | ")} |`);
  }
  return head.join("\n");
}

function databaseToCsv(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  const lines = [`# ${item.title}`, csvRow(columns)];
  for (const row of item.rows) lines.push(csvRow(columns.map((column) => propertyValue(row.properties?.[column], options))));
  return lines.join("\n");
}

function databaseColumns(item: DatabaseExportItem): string[] {
  if (item.selectedColumns && item.selectedColumns.length > 0) {
    return item.selectedColumns;
  }
  if (item.columns && item.columns.length > 0) {
    return item.columns;
  }
  const seen = new Set<string>();
  for (const row of item.rows) {
    for (const column of Object.keys(row.properties ?? {})) seen.add(column);
  }
  return [...seen];
}

function pagePropertiesToMarkdown(page: NotionPage, options: ExportOptions): string {
  const entries = Object.entries(page.properties ?? {}).map(([key, value]) => `- **${key}:** ${propertyValue(value, options)}`);
  return entries.length ? entries.join("\n") : "";
}

function blockToMarkdown(block: NotionBlock): string {
  const data: any = block[block.type];
  const text = richTextToMarkdown(data?.rich_text);
  const children = block.children?.map(blockToMarkdown).filter(Boolean).join("\n") ?? "";
  let line = "";
  switch (block.type) {
    case "paragraph":
      line = text;
      break;
    case "heading_1":
      line = `# ${text}`;
      break;
    case "heading_2":
      line = `## ${text}`;
      break;
    case "heading_3":
      line = `### ${text}`;
      break;
    case "bulleted_list_item":
      line = `- ${text}`;
      break;
    case "numbered_list_item":
      line = `1. ${text}`;
      break;
    case "to_do":
      line = `- [${data?.checked ? "x" : " "}] ${text}`;
      break;
    case "quote":
      line = `> ${text}`;
      break;
    case "code":
      line = `\`\`\`${data?.language ?? ""}\n${text}\n\`\`\``;
      break;
    case "divider":
      line = "---";
      break;
    case "callout":
      line = `> ${text}`;
      break;
    default:
      line = "";
  }
  return [line, children].filter(Boolean).join("\n");
}

function richTextToMarkdown(richText: any[] = []): string {
  return richText.map((part) => {
    let text = part.plain_text ?? "";
    if (part.annotations?.code) text = `\`${text}\``;
    if (part.annotations?.bold) text = `**${text}**`;
    if (part.annotations?.italic) text = `_${text}_`;
    if (part.annotations?.strikethrough) text = `~~${text}~~`;
    return text;
  }).join("");
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
}

function escapeMarkdown(value: string): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
