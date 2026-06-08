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
  id?: string;
  title: string; 
  page?: NotionPage; 
  blocks?: NotionBlock[]; 
  includeProperties?: boolean;
  depth?: number;
};
export type ExportItem = DatabaseExportItem | PageExportItem;

export type ExportOptions = PropertyValueOptions;

export function exportMarkdown(items: ExportItem[], options: ExportOptions = {}): string {
  const definitionOutputs: string[] = [];
  const structureOutputs: string[] = [];

  const uniqueDbs = new Map<string, DatabaseExportItem>();
  const uniquePages = new Map<string, PageExportItem>();

  for (const item of items) {
    if (isDatabaseItem(item)) {
      if (item.id && !uniqueDbs.has(item.id)) {
        uniqueDbs.set(item.id, item);
      }
    } else {
      const pageId = item.page?.id || item.id;
      if (pageId && !uniquePages.has(pageId)) {
        uniquePages.set(pageId, item as PageExportItem);
      }
    }
  }

  definitionOutputs.push("# Definition");
  
  for (const db of uniqueDbs.values()) {
    definitionOutputs.push(databaseToXml(db, options));
  }
  
  for (const page of uniquePages.values()) {
    const xml = pagePropertiesToXml(page, options);
    if (xml) definitionOutputs.push(xml);
  }

  structureOutputs.push("# Structure");
  
  const hierarchyStr = generateHierarchyTree(items);
  if (hierarchyStr) {
    structureOutputs.push(hierarchyStr);
  }
  
  const blocksOutputs: string[] = [];
  for (const page of uniquePages.values()) {
    const blocksStr = pageBlocksToXml(page, options);
    if (blocksStr) {
      blocksOutputs.push(blocksStr);
    }
  }

  if (blocksOutputs.length > 0) {
    structureOutputs.push(blocksOutputs.join("\n\n"));
  }

  if (!hierarchyStr && blocksOutputs.length === 0) {
    structureOutputs.push("<!-- No nested structure or blocks available -->");
  }

  const defStr = definitionOutputs.join("\n\n");
  const structStr = structureOutputs.join("\n\n");

  return [defStr, structStr].filter(Boolean).join("\n\n---\n\n");
}

function generateHierarchyTree(items: ExportItem[]): string {
  const lines: string[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    const id = isDatabaseItem(item) ? item.id : (item.page?.id || item.id);
    const depth = item.depth ?? 0;
    const indent = "  ".repeat(depth);
    
    if (id && !seenIds.has(id)) {
      lines.push(`${indent}- [${item.kind}] ${item.title} (${id})`);
      seenIds.add(id);
    }

    if (isDatabaseItem(item)) {
      const rowIndent = "  ".repeat(depth + 1);
      for (const row of item.rows) {
        if (!seenIds.has(row.id)) {
           lines.push(`${rowIndent}- [row] ${pageTitle(row) || "Untitled"} (${row.id})`);
           seenIds.add(row.id);
        }
      }
    }
  }

  return lines.join("\n");
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
  lines.push(`<page-count>${item.rows.length}</page-count>`);
  lines.push("</meta>");

  lines.push("<schema>");
  for (const column of columns) {
    lines.push(columnSchemaXml(item, column));
  }
  lines.push("</schema>");

  if (!columns.length || item.rows.length === 0) {
    lines.push("<pages />");
    lines.push("</database>");
    return lines.join("\n");
  }

  lines.push(`<pages display="table">`);
  for (const row of item.rows) {
    lines.push(pageRowToXml(row, columns, options));
  }
  lines.push("</pages>");
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

function pageRowToXml(row: NotionPage, columns: string[], options: ExportOptions): string {
  const lines = [`<page id="${escapeXmlAttribute(row.id)}" title="${escapeXmlAttribute(pageTitle(row) || "Untitled Entry")}">`];
  for (const column of columns) {
    const prop = row.properties?.[column];
    const type = prop?.type ?? "unknown";
    lines.push(`<property name="${escapeXmlAttribute(column)}" type="${escapeXmlAttribute(type)}">${escapeXmlText(propertyValue(prop, options))}</property>`);
  }
  lines.push("</page>");
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

function pagePropertiesToXml(item: PageExportItem, options: ExportOptions): string | null {
  if (item.includeProperties === false) return null; // Already in a database table!

  const id = item.page?.id || item.id;
  const attributes = [`title="${escapeXmlAttribute(item.title)}"`];
  if (id) attributes.unshift(`id="${escapeXmlAttribute(id)}"`);
  if (item.depth !== undefined) attributes.push(`depth="${item.depth}"`);
  
  const lines = [`<page ${attributes.join(" ")}>`];

  if (item.page?.properties && Object.keys(item.page.properties).length > 0) {
    lines.push("<properties>");
    for (const [name, prop] of Object.entries(item.page.properties)) {
      lines.push(`<property name="${escapeXmlAttribute(name)}">${escapeXmlText(propertyValue(prop, options))}</property>`);
    }
    lines.push("</properties>");
  }

  lines.push("</page>");
  return lines.join("\n");
}

function pageBlocksToXml(item: PageExportItem, options: ExportOptions): string | null {
  const blocks = item.blocks?.map((b) => blockToXml(b, options)).filter(Boolean) ?? [];
  if (blocks.length === 0) return null;

  const id = item.page?.id || item.id;
  const attributes = [`title="${escapeXmlAttribute(item.title)}"`];
  if (id) attributes.unshift(`id="${escapeXmlAttribute(id)}"`);
  
  const lines = [`<page-structure ${attributes.join(" ")}>`];
  lines.push(...blocks);
  lines.push("</page-structure>");
  return lines.join("\n");
}

function blockToXml(block: NotionBlock, options?: ExportOptions): string {
  const b = block as any;
  const data: any = b[b.type];
  const text = richTextToPlainText(data?.rich_text);
  const children = b.children?.map((child: any) => blockToXml(child, options)).filter(Boolean) ?? [];
  
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
      return children.join("\n\n") || "";
    case "column":
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
      return `<block type="child_database" id="${escapeXmlAttribute(b.id)}" title="${escapeXmlAttribute(b.child_database?.title ?? "Untitled db")}" />`;
    case "child_page":
      return `<block type="child_page" id="${escapeXmlAttribute(b.id)}" title="${escapeXmlAttribute(b.child_page?.title ?? "Untitled page")}" />`;
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
