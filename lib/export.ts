import type { NotionBlock, NotionPage } from "@/types/notion";
import { propertyValue, type PropertyValueOptions } from "@/lib/notion";

export type DatabaseExportItem = { 
  kind: "database" | "data_source"; 
  title: string; 
  rows: NotionPage[]; 
  columns?: string[]; 
  selectedColumns?: string[];
  properties?: Record<string, any>;
};
export type PageExportItem = { kind: "page" | "row" | "block"; title: string; page?: NotionPage; blocks?: NotionBlock[]; includeProperties?: boolean };
export type ExportItem = DatabaseExportItem | PageExportItem;

export type ExportOptions = PropertyValueOptions;

export function exportMarkdown(items: ExportItem[], options: ExportOptions = {}): string {
  return items.map((item) => {
    if (isDatabaseItem(item)) {
      return databaseToMarkdown(item, options);
    }
    return pageToXml(item, options);
  }).join("\n\n---\n\n");
}

export function exportCsv(items: ExportItem[], options: ExportOptions = {}): string {
  return items.map((item) => {
    if (isDatabaseItem(item)) {
      return databaseToCsv(item, options);
    }
    return pageToXml(item, options);
  }).join("\n\n");
}

function isDatabaseItem(item: ExportItem): item is DatabaseExportItem {
  return item.kind === "database" || item.kind === "data_source";
}

function databaseToMarkdown(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  const head = [`## ${item.title}`];

  // Add column metadata (options/descriptions) for select/multi_select/status
  const metadataLines: string[] = [];
  if (item.properties) {
    for (const column of columns) {
      const prop = item.properties[column];
      if (!prop) continue;

      let columnInfo = "";
      if (prop.type === "select" && prop.select?.options?.length > 0) {
        columnInfo = `Options: ${prop.select.options.map((o: any) => o.name).join(", ")}`;
      } else if (prop.type === "multi_select" && prop.multi_select?.options?.length > 0) {
        columnInfo = `Options: ${prop.multi_select.options.map((o: any) => o.name).join(", ")}`;
      } else if (prop.type === "status" && prop.status?.options?.length > 0) {
        columnInfo = `Options: ${prop.status.options.map((o: any) => o.name).join(", ")}`;
      }

      if (columnInfo) {
        metadataLines.push(`- **${column}** (${prop.type}): ${columnInfo}${prop.description ? ` — ${prop.description}` : ""}`);
      }
    }
  }

  if (metadataLines.length > 0) {
    head.push("\n### Column Information");
    head.push(...metadataLines);
    head.push("");
  }

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
  const lines = [`# ${item.title}`];

  // Add metadata as comments or header lines in CSV if needed?
  // For CSV, it's cleaner to keep it in the header comments or a separate section.
  if (item.properties) {
    for (const column of columns) {
      const prop = item.properties[column];
      if (!prop) continue;

      let columnInfo = "";
      if (prop.type === "select" && prop.select?.options?.length > 0) {
        columnInfo = `Options: ${prop.select.options.map((o: any) => o.name).join(", ")}`;
      } else if (prop.type === "multi_select" && prop.multi_select?.options?.length > 0) {
        columnInfo = `Options: ${prop.multi_select.options.map((o: any) => o.name).join(", ")}`;
      } else if (prop.type === "status" && prop.status?.options?.length > 0) {
        columnInfo = `Options: ${prop.status.options.map((o: any) => o.name).join(", ")}`;
      }

      if (columnInfo) {
        lines.push(`# Column: ${column} (${prop.type}) - ${columnInfo}${prop.description ? ` - ${prop.description}` : ""}`);
      }
    }
  }

  lines.push(csvRow(columns));
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

function pageToXml(item: PageExportItem, options: ExportOptions): string {
  const id = item.page?.id;
  const attributes = [`title="${escapeXmlAttribute(item.title)}"`];
  if (id) attributes.unshift(`id="${escapeXmlAttribute(id)}"`);
  if (item.kind === "row") attributes.push(`kind="row"`);
  if (item.kind === "block") attributes.push(`kind="block"`);
  const lines = [`<page ${attributes.join(" ")}>`];

  if (item.includeProperties !== false && item.page?.properties && Object.keys(item.page.properties).length > 0) {
    lines.push(indent("<properties>"));
    for (const [name, prop] of Object.entries(item.page.properties)) {
      lines.push(indent(`<property name="${escapeXmlAttribute(name)}">${escapeXmlText(propertyValue(prop, options))}</property>`, 2));
    }
    lines.push(indent("</properties>"));
  }

  const blocks = item.blocks?.map(blockToXml).filter(Boolean) ?? [];
  if (blocks.length > 0) {
    lines.push(indent("<content>"));
    for (const block of blocks) lines.push(indent(block, 2));
    lines.push(indent("</content>"));
  }

  lines.push("</page>");
  return lines.join("\n");
}

function blockToXml(block: NotionBlock): string {
  const data: any = block[block.type];
  const text = richTextToPlainText(data?.rich_text);
  const children = block.children?.map(blockToXml).filter(Boolean) ?? [];
  let tag = "";
  let attributes = "";
  switch (block.type) {
    case "paragraph":
      tag = "paragraph";
      break;
    case "heading_1":
      tag = "heading";
      attributes = ` level="1"`;
      break;
    case "heading_2":
      tag = "heading";
      attributes = ` level="2"`;
      break;
    case "heading_3":
      tag = "heading";
      attributes = ` level="3"`;
      break;
    case "bulleted_list_item":
      tag = "bulleted_list_item";
      break;
    case "numbered_list_item":
      tag = "numbered_list_item";
      break;
    case "to_do":
      tag = "to_do";
      attributes = ` checked="${data?.checked ? "true" : "false"}"`;
      break;
    case "quote":
      tag = "quote";
      break;
    case "code":
      tag = "code";
      attributes = data?.language ? ` language="${escapeXmlAttribute(data.language)}"` : "";
      break;
    case "divider":
      return "<divider />";
      break;
    case "callout":
      tag = "callout";
      break;
    default:
      return "";
  }

  if (children.length === 0) return `<${tag}${attributes}>${escapeXmlText(text)}</${tag}>`;

  const lines = [`<${tag}${attributes}>`];
  if (text) lines.push(indent(escapeXmlText(text)));
  for (const child of children) lines.push(indent(child));
  lines.push(`</${tag}>`);
  return lines.join("\n");
}

function richTextToPlainText(richText: any[] = []): string {
  return richText.map((part) => {
    return part.plain_text ?? "";
  }).join("");
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
}

function escapeMarkdown(value: string): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function escapeXmlText(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function indent(value: string, depth = 1): string {
  const prefix = "  ".repeat(depth);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}
