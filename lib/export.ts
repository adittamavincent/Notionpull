import type { NotionBlock, NotionPage } from "@/types/notion";
import { propertyValue, type PropertyValueOptions } from "@/lib/notion";

export type DatabaseExportItem = { 
  kind: "database" | "data_source"; 
  title: string; 
  rows: NotionPage[]; 
  columns?: string[]; 
  selectedColumns?: string[];
  properties?: Record<string, any>;
  depth?: number;
  id?: string;
};
export type PageExportItem = { 
  kind: "page" | "row" | "block"; 
  title: string; 
  page?: NotionPage; 
  blocks?: NotionBlock[]; 
  includeProperties?: boolean;
  depth?: number;
};
export type ExportItem = DatabaseExportItem | PageExportItem;

export type ExportOptions = PropertyValueOptions;

export function exportMarkdown(items: ExportItem[], options: ExportOptions = {}): string {
  const dbById = new Map<string, DatabaseExportItem>();
  for (const item of items) {
    if (isDatabaseItem(item) && item.id) {
      dbById.set(item.id, item);
    }
  }

  const renderedDbIds = new Set<string>();

  // Process pages first to allow databases to be embedded
  const pageItems = items.filter(item => !isDatabaseItem(item));
  const databaseItems = items.filter(item => isDatabaseItem(item));

  const pageOutputs = pageItems.map((item) => {
    return pageToXml(item as PageExportItem, options, dbById, renderedDbIds);
  });

  // Then process any remaining databases that weren't embedded in pages
  const dbOutputs = databaseItems.map((item) => {
    const dbItem = item as DatabaseExportItem;
    if (dbItem.id && renderedDbIds.has(dbItem.id)) return null;
    if (dbItem.id) renderedDbIds.add(dbItem.id);
    return databaseToMarkdown(dbItem, options);
  }).filter(Boolean);

  return [...pageOutputs, ...dbOutputs].join("\n\n---\n\n");
}

function isDatabaseItem(item: ExportItem): item is DatabaseExportItem {
  return item.kind === "database" || item.kind === "data_source";
}

function getHeadingLevel(depth?: number) {
  return Math.min(6, (depth ?? 0) + 2);
}

function databaseToMarkdown(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  const hLevel = getHeadingLevel(item.depth);
  const hMain = "#".repeat(hLevel);
  const hSub = "#".repeat(hLevel + 1);
  
  const head = [`${hMain} ${item.title}`];

  const metadataLines = getMetadataLines(item);
  if (metadataLines.length > 0) {
    head.push("");
    head.push(`${hSub} Column Information`);
    head.push(...metadataLines);
  }

  if (!columns.length) return head.join("\n") + "\n\n_No columns._";
  
  head.push("");
  head.push(`| ${columns.map(escapeMarkdown).join(" | ")} |`);
  head.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of item.rows) {
    head.push(`| ${columns.map((column) => escapeMarkdown(propertyValue(row.properties?.[column], options))).join(" | ")} |`);
  }
  return head.join("\n");
}

function getMetadataLines(item: DatabaseExportItem): string[] {
  const columns = databaseColumns(item);
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

      const infoPart = columnInfo ? `: ${columnInfo}` : "";
      const descPart = prop.description ? ` — ${prop.description}` : "";
      metadataLines.push(`- **${column}** (${prop.type})${infoPart}${descPart}`);
    }
  }
  return metadataLines;
}

function databaseColumns(item: DatabaseExportItem): string[] {
  if (item.selectedColumns && item.selectedColumns.length > 0) {
    return item.selectedColumns;
  }
  if (item.columns && item.columns.length > 0) {
    return item.columns;
  }
  if (item.properties && Object.keys(item.properties).length > 0) {
    return Object.keys(item.properties);
  }
  const seen = new Set<string>();
  for (const row of item.rows) {
    for (const column of Object.keys(row.properties ?? {})) seen.add(column);
  }
  return [...seen];
}

function pageToXml(item: PageExportItem, options: ExportOptions, dbById?: Map<string, DatabaseExportItem>, renderedDbIds?: Set<string>): string {
  const id = item.page?.id;
  const attributes = [`title="${escapeXmlAttribute(item.title)}"`];
  if (id) attributes.unshift(`id="${escapeXmlAttribute(id)}"`);
  if (item.kind === "row") attributes.push(`kind="row"`);
  if (item.kind === "block") attributes.push(`kind="block"`);
  if (item.depth !== undefined) attributes.push(`depth="${item.depth}"`);
  const lines = [`<page ${attributes.join(" ")}>`];

  if (item.includeProperties !== false && item.page?.properties && Object.keys(item.page.properties).length > 0) {
    lines.push(indent("<properties>"));
    for (const [name, prop] of Object.entries(item.page.properties)) {
      lines.push(indent(`<property name="${escapeXmlAttribute(name)}">${escapeXmlText(propertyValue(prop, options))}</property>`, 2));
    }
    lines.push(indent("</properties>"));
  }

  const blocks = item.blocks?.map((b) => blockToXml(b, dbById, renderedDbIds, options)).filter(Boolean) ?? [];
  if (blocks.length > 0) {
    lines.push(indent("<content>"));
    for (const block of blocks) lines.push(indent(block, 2));
    lines.push(indent("</content>"));
  }

  lines.push("</page>");
  return lines.join("\n");
}

function blockToXml(block: NotionBlock, dbById?: Map<string, DatabaseExportItem>, renderedDbIds?: Set<string>, options?: ExportOptions): string {
  const b = block as any;
  const data: any = b[b.type];
  const text = richTextToPlainText(data?.rich_text);
  const children = b.children?.map((child: any) => blockToXml(child, dbById, renderedDbIds, options)).filter(Boolean) ?? [];
  let tag = "";
  let attributes = "";
  switch (b.type) {
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
    case "child_database":
      if (dbById && renderedDbIds && options) {
        const dbId = b.id;
        const dbItem = dbById.get(dbId);
        if (dbItem) {
          renderedDbIds.add(dbId);
          const xml = `<database id="${escapeXmlAttribute(dbId)}" title="${escapeXmlAttribute(dbItem.title)}" />`;
          const content = databaseToMarkdown(dbItem, options);
          return `${content}\n\n${xml}`;
        }
      }
      return `<database id="${escapeXmlAttribute(b.id)}" title="${escapeXmlAttribute(b.child_database?.title ?? "Untitled database")}" />`;
    case "child_page":
      return `<page id="${escapeXmlAttribute(b.id)}" title="${escapeXmlAttribute(b.child_page?.title ?? "Untitled page")}" />`;
    default:
      return "";
  }

  if (!text && children.length === 0) return "";

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
  }).join("").trim();
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
