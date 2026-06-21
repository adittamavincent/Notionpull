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
  comments?: any[];
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
    definitionOutputs.push(databaseToMarkdownTable(db, options));
  }
  
  for (const page of uniquePages.values()) {
    const xml = pageToXml(page, options);
    if (xml) definitionOutputs.push(xml);
  }

  structureOutputs.push("# Structure");
  
  const hierarchyStr = generateHierarchyTree(items);
  if (hierarchyStr) {
    structureOutputs.push(hierarchyStr);
  } else {
    structureOutputs.push("<!-- No nested structure available -->");
  }

  const defStr = definitionOutputs.join("\n\n");
  const structStr = structureOutputs.join("\n\n");

  return [defStr, structStr].filter(Boolean).join("\n\n---\n\n");
}

function generateHierarchyTree(items: ExportItem[]): string {
  const lines: string[] = [];

  const exportedItemIds = new Set<string>();
  for (const item of items) {
    if (!isDatabaseItem(item)) {
      const id = item.page?.id || item.id;
      if (id) exportedItemIds.add(id);
    }
  }

  for (const item of items) {
    const id = isDatabaseItem(item) ? item.id : (item.page?.id || item.id);
    const depth = item.depth ?? 0;
    const indent = "  ".repeat(depth);
    
    if (id) {
      lines.push(`${indent}- [${item.kind}] ${item.title} (${id})`);
    }

    if (isDatabaseItem(item)) {
      const rowIndent = "  ".repeat(depth + 1);
      const seenRowIds = new Set<string>();
      for (const row of item.rows) {
        if (!seenRowIds.has(row.id) && !exportedItemIds.has(row.id)) {
           lines.push(`${rowIndent}- [row] ${pageTitle(row) || "Untitled"} (${row.id})`);
           seenRowIds.add(row.id);
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

function databaseToMarkdownTable(item: DatabaseExportItem, options: ExportOptions): string {
  const columns = databaseColumns(item);
  
  const xmlLines = [`<database name="${escapeXmlAttribute(item.title)}">`];
  xmlLines.push("  <meta>");
  if (item.id) xmlLines.push(`    <id>${escapeXmlText(item.id)}</id>`);
  const viewLine = getViewLine(item);
  if (viewLine) xmlLines.push(`    <view id="${escapeXmlAttribute(item.viewId ?? "")}" title="${escapeXmlAttribute(item.viewTitle ?? "")}">${escapeXmlText(viewLine)}</view>`);
  xmlLines.push(`    <page-count>${item.rows.length}</page-count>`);
  xmlLines.push("  </meta>");

  xmlLines.push("  <schema>");
  for (const column of columns) {
    xmlLines.push(indent(columnSchemaXml(item, column), 2));
  }
  xmlLines.push("  </schema>");

  if (!columns.length || item.rows.length === 0) {
    xmlLines.push("  *(Empty database)*");
  } else {
    const colHeaders = columns.map(col => {
      const prop = item.properties?.[col];
      const type = prop?.type ?? "unknown";
      return `${col} (${type})`;
    });

    const tableLines = [
      `  | ID | ${colHeaders.join(" | ")} |`,
      `  | --- | ${columns.map(() => "---").join(" | ")} |`
    ];

    for (const row of item.rows) {
      const cells = columns.map(col => {
        const prop = row.properties?.[col];
        return escapeMarkdown(propertyValue(prop, options));
      });
      tableLines.push(`  | ${row.id} | ${cells.join(" | ")} |`);
    }

    xmlLines.push(tableLines.join("\n"));
  }

  xmlLines.push("</database>");

  return xmlLines.join("\n");
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

  if (prop?.type === "relation" && prop.relation?.database_id) {
    attrs.push(`relation-database-id="${escapeXmlAttribute(prop.relation.database_id)}"`);
  } else if (prop?.type === "rollup" && prop.rollup) {
    const relName = prop.rollup.relation_property_name;
    const relId = prop.rollup.relation_property_id;
    let relProp = item.properties && relName ? item.properties[relName] : null;
    if (!relProp && item.properties && relId) {
      relProp = Object.values(item.properties).find((p: any) => p.id === relId);
    }
    if (relProp && relProp.type === "relation" && relProp.relation?.database_id) {
      attrs.push(`relation-database-id="${escapeXmlAttribute(relProp.relation.database_id)}"`);
    }
  }

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

function pageToXml(item: PageExportItem, options: ExportOptions): string | null {
  const id = item.page?.id || item.id;
  const blocks = item.blocks?.map((b) => blockToXml(b, options)).filter(Boolean) ?? [];
  const hasBlocks = blocks.length > 0;
  const comments = item.comments || [];
  const hasComments = comments.length > 0;

  if (item.includeProperties === false && !hasBlocks && !hasComments) {
    return null;
  }

  const attributes = [`title="${escapeXmlAttribute(item.title)}"`];
  if (id) attributes.unshift(`id="${escapeXmlAttribute(id)}"`);
  if (item.depth !== undefined) attributes.push(`depth="${item.depth}"`);
  
  const lines = [`<page ${attributes.join(" ")}>`];

  if (item.includeProperties !== false && item.page?.properties && Object.keys(item.page.properties).length > 0) {
    lines.push("  <properties>");
    for (const [name, prop] of Object.entries(item.page.properties)) {
      lines.push(`    <property name="${escapeXmlAttribute(name)}">${escapeXmlText(propertyValue(prop, options))}</property>`);
    }
    lines.push("  </properties>");
  }

  if (hasComments) {
    lines.push("  <comments>");
    for (const comment of comments) {
      const author = comment.created_by?.name ?? comment.created_by?.id ?? "Unknown";
      const time = comment.created_time ?? "";
      const text = richTextToPlainText(comment.rich_text);
      lines.push(`    <comment author="${escapeXmlAttribute(author)}" time="${escapeXmlAttribute(time)}">${escapeXmlText(text)}</comment>`);
    }
    lines.push("  </comments>");
  }

  if (hasBlocks) {
    for (const block of blocks) {
      lines.push(indent(block, 1));
    }
  }

  lines.push("</page>");
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
