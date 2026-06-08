import type { NotionBlock, NotionPage } from "@/types/notion";
import { propertyValue, pageTitle, type PropertyValueOptions } from "@/lib/notion";

export type DatabaseExportItem = { 
  kind: "database" | "data_source"; 
  title: string; 
  rows: NotionPage[]; 
  columns?: string[]; 
  selectedColumns?: string[];
  columnDetails?: Array<{ id?: string; name: string; visible?: boolean; width?: number }>;
  viewId?: string;
  viewTitle?: string;
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
    return databaseToXml(dbItem, options);
  }).filter(Boolean);

  return [...pageOutputs, ...dbOutputs].join("\n\n---\n\n");
}

function isDatabaseItem(item: ExportItem): item is DatabaseExportItem {
  return item.kind === "database" || item.kind === "data_source";
}

function getHeadingLevel(depth?: number) {
  return Math.min(6, (depth ?? 0) + 2);
}

function databaseToXml(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  const attrs = [`title="${escapeXmlAttribute(item.title)}"`];
  if (item.id) attrs.unshift(`id="${escapeXmlAttribute(item.id)}"`);
  attrs.push(`kind="${escapeXmlAttribute(item.kind)}"`);
  attrs.push(`display="table"`);
  if (item.depth !== undefined) attrs.push(`depth="${item.depth}"`);

  const lines = [`<database ${attrs.join(" ")}>`];
  lines.push("<meta>");
  if (item.id) lines.push(`<id>${escapeXmlText(item.id)}</id>`);
  const viewLine = getViewLine(item);
  if (viewLine) lines.push(`<view id="${escapeXmlAttribute(item.viewId ?? "")}" title="${escapeXmlAttribute(item.viewTitle ?? "")}">${escapeXmlText(viewLine)}</view>`);
  lines.push(`<row-count>${item.rows.length}</row-count>`);
  lines.push("</meta>");

  lines.push("<schema>");
  for (const column of columns) {
    lines.push(columnSchemaXml(item, column));
  }
  lines.push("</schema>");

  if (!columns.length || item.rows.length === 0) {
    lines.push("<rows />");
    lines.push("</database>");
    return lines.join("\n");
  }

  lines.push(`<rows display="table">`);
  for (const row of item.rows) {
    lines.push(rowToXml(row, columns, options));
  }
  lines.push("</rows>");
  lines.push("</database>");
  return lines.join("\n");
}

function columnSchemaXml(item: DatabaseExportItem, columnName: string): string {
  const prop = item.properties?.[columnName];
  const detail = item.columnDetails?.find((d) => d.name === columnName);
  const attrs = [
    `name="${escapeXmlAttribute(columnName)}"`,
    `type="${escapeXmlAttribute(prop?.type ?? "unknown")}"`,
    `visible="${detail?.visible === false ? "false" : "true"}"`
  ];
  if (prop?.id) attrs.push(`property-id="${escapeXmlAttribute(prop.id)}"`);
  if (detail?.width !== undefined) attrs.push(`width="${detail.width}"`);

  const options = propertyOptions(prop);
  const desc = prop?.description ? `<description>${escapeXmlText(prop.description)}</description>` : "";
  if (!options.length && !desc) return `<property ${attrs.join(" ")} />`;

  const lines = [`<property ${attrs.join(" ")}>`];
  if (desc) lines.push(desc);
  if (options.length) {
    lines.push("<options>");
    for (const option of options) lines.push(`<option>${escapeXmlText(option)}</option>`);
    lines.push("</options>");
  }
  lines.push("</property>");
  return lines.join("\n");
}

function propertyOptions(prop: any): string[] {
  if (!prop) return [];
  if (prop.type === "select") return prop.select?.options?.map((o: any) => o.name).filter(Boolean) ?? [];
  if (prop.type === "multi_select") return prop.multi_select?.options?.map((o: any) => o.name).filter(Boolean) ?? [];
  if (prop.type === "status") return prop.status?.options?.map((o: any) => o.name).filter(Boolean) ?? [];
  return [];
}

function rowToXml(row: NotionPage, columns: string[], options: ExportOptions): string {
  const lines = [`<row id="${escapeXmlAttribute(row.id)}" title="${escapeXmlAttribute(pageTitle(row) || "Untitled Entry")}">`];
  for (const column of columns) {
    const prop = row.properties?.[column];
    const type = prop?.type ?? "unknown";
    lines.push(`<property name="${escapeXmlAttribute(column)}" type="${escapeXmlAttribute(type)}">${escapeXmlText(propertyValue(prop, options))}</property>`);
  }
  lines.push("</row>");
  return lines.join("\n");
}

function getViewLine(item: DatabaseExportItem): string {
  if (!item.viewId && !item.viewTitle) return "";
  if (item.viewTitle && item.viewId) return `${item.viewTitle} (${item.viewId})`;
  return item.viewTitle || item.viewId || "";
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
  if (item.depth !== undefined) attributes.push(`depth="${item.depth}"`);
  
  const lines = [`<page ${attributes.join(" ")}>`];

  if (item.includeProperties !== false && item.page?.properties && Object.keys(item.page.properties).length > 0) {
    lines.push("<props>");
    for (const [name, prop] of Object.entries(item.page.properties)) {
      lines.push(`<p n="${escapeXmlAttribute(name)}">${escapeXmlText(propertyValue(prop, options))}</p>`);
    }
    lines.push("</props>");
  }

  const blocks = item.blocks?.map((b) => blockToXml(b, dbById, renderedDbIds, options)).filter(Boolean) ?? [];
  if (blocks.length > 0) {
    lines.push(...blocks);
  }

  lines.push("</page>");
  return lines.join("\n");
}

function blockToXml(block: NotionBlock, dbById?: Map<string, DatabaseExportItem>, renderedDbIds?: Set<string>, options?: ExportOptions): string {
  const b = block as any;
  const data: any = b[b.type];
  const text = richTextToPlainText(data?.rich_text);
  const children = b.children?.map((child: any) => blockToXml(child, dbById, renderedDbIds, options)).filter(Boolean) ?? [];
  
  let content = "";
  switch (b.type) {
    case "paragraph":
      content = text;
      break;
    case "heading_1":
      content = `# ${text}`;
      break;
    case "heading_2":
      content = `## ${text}`;
      break;
    case "heading_3":
      content = `### ${text}`;
      break;
    case "bulleted_list_item":
      content = `- ${text}`;
      break;
    case "numbered_list_item":
      content = `1. ${text}`;
      break;
    case "to_do":
      content = `- [${data?.checked ? "x" : " "}] ${text}`;
      break;
    case "quote":
      content = `> ${text}`;
      break;
    case "code":
      content = `\`\`\`${data?.language || ""}\n${text}\n\`\`\``;
      break;
    case "divider":
      return "---";
    case "callout":
      content = `> [!NOTE]\n> ${text}`;
      break;
    case "column_list":
      // Render each column's content side-by-side on new lines (plain text fallback)
      return children.join("\n\n") || "";
    case "column":
      // Transparent wrapper — just pass through children
      return children.join("\n") || "";
    case "table": {
      const rows = b.children || [];
      if (rows.length === 0) return "";
      const mdRows: string[] = [];
      let numColumns = 0;
      
      for (const rowBlock of rows) {
        if (rowBlock.type !== "table_row") continue;
        const rowData = rowBlock.table_row;
        if (!rowData || !rowData.cells) continue;
        const cells = rowData.cells.map((cell: any) => {
          return escapeMarkdown(richTextToPlainText(cell));
        });
        if (cells.length > numColumns) {
          numColumns = cells.length;
        }
        mdRows.push(`| ${cells.join(" | ")} |`);
      }
      
      if (mdRows.length === 0) return "";
      
      const separator = `| ${Array(numColumns).fill("---").join(" | ")} |`;
      mdRows.splice(1, 0, separator);
      
      return mdRows.join("\n");
    }
    case "table_row": {
      const cells = data?.cells?.map((cell: any) => escapeMarkdown(richTextToPlainText(cell))) ?? [];
      return `| ${cells.join(" | ")} |`;
    }
    case "child_database":
      if (dbById && renderedDbIds && options) {
        const dbId = b.id;
        const dbItem = dbById.get(dbId);
        if (dbItem) {
          renderedDbIds.add(dbId);
          const xml = `<db id="${escapeXmlAttribute(dbId)}" t="${escapeXmlAttribute(dbItem.title)}" />`;
          const content = databaseToXml(dbItem, options);
          return `${content}\n\n${xml}`;
        }
      }
      return `<db id="${escapeXmlAttribute(b.id)}" t="${escapeXmlAttribute(b.child_database?.title ?? "Untitled db")}" />`;
    case "child_page":
      return `<link id="${escapeXmlAttribute(b.id)}" t="${escapeXmlAttribute(b.child_page?.title ?? "Untitled page")}" />`;
    default:
      return "";
  }

  if (!content && children.length === 0) return "";
  if (children.length === 0) return content;

  return `${content}\n${children.map((c: string) => indent(c)).join("\n")}`;
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
