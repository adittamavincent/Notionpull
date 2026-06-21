import { useEffect, useMemo, useRef, useState } from "react";
import { X, Activity, RefreshCw, Trash2, ChevronRight, ChevronDown, TerminalSquare, Copy, Check } from "lucide-react";
import type { LogEntry } from "@/lib/logger";
import { HighlightedCode } from "./ExportModal";

type DebugViewMode = "chronological" | "tree";
type LogCopyMode = "surface" | "full";

type TreeLogNode = {
  key: string;
  label: string;
  path: string;
  depth: number;
  log?: LogEntry;
  isBranch: boolean;
  sortStamp: number;
  children: TreeLogNode[];
};

function formatClock(timestamp: number) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatPath(url: string) {
  return url.replace("https://api.notion.com/v1", "");
}

interface ParsedEndpoint {
  category: string;
  pattern: string;
  resourceId?: string;
  resourceIdName?: string;
  subId?: string;
  subIdName?: string;
}

function parseEndpointPattern(method: string, url: string): ParsedEndpoint {
  let path = url;
  if (url.startsWith("http")) {
    try {
      path = new URL(url).pathname;
    } catch (e) {
      path = url.replace("https://api.notion.com", "");
    }
  } else {
    path = url;
  }
  path = path.split("?")[0];
  const parts = path.split("/").filter(Boolean);

  const isId = (segment: string) => {
    if (!segment) return false;
    const clean = segment.replace(/-/g, "");
    return /^[a-f0-9]{32}$/i.test(clean);
  };

  const getCategory = (base: string): string => {
    switch (base) {
      case "users": return "Users";
      case "pages": return "Pages";
      case "blocks": return "Blocks";
      case "data_sources": return "Data Sources";
      case "databases": return "Databases";
      case "comments": return "Comments";
      case "file_uploads": return "File Uploads";
      case "custom_emojis": return "Custom Emojis";
      case "views": return "Views";
      case "search": return "Search";
      case "oauth": return "OAuth";
      default: return base.charAt(0).toUpperCase() + base.slice(1).replace(/_/g, " ");
    }
  };

  let startIndex = parts[0] === "v1" ? 1 : 0;
  const apiPrefix = parts[0] === "v1" ? "/v1" : "";

  if (parts.length - startIndex === 0) {
    return { category: "API", pattern: method + " " + path };
  }

  const baseSegment = parts[startIndex];
  const category = getCategory(baseSegment);

  if (baseSegment === "users") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/users` };
    }
    if (parts[startIndex + 1] === "me") {
      return { category, pattern: `${method} ${apiPrefix}/users/me` };
    }
    return {
      category,
      pattern: `${method} ${apiPrefix}/users/{user_id}`,
      resourceId: parts[startIndex + 1],
      resourceIdName: "user_id"
    };
  }

  if (baseSegment === "pages") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/pages` };
    }
    const pageId = parts[startIndex + 1];
    if (parts.length - startIndex === 2) {
      return {
        category,
        pattern: `${method} ${apiPrefix}/pages/{page_id}`,
        resourceId: pageId,
        resourceIdName: "page_id"
      };
    }
    if (parts[startIndex + 2] === "move") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/pages/{page_id}/move`,
        resourceId: pageId,
        resourceIdName: "page_id"
      };
    }
    if (parts[startIndex + 2] === "markdown") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/pages/{page_id}/markdown`,
        resourceId: pageId,
        resourceIdName: "page_id"
      };
    }
    if (parts[startIndex + 2] === "properties") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/pages/{page_id}/properties/{property_id}`,
        resourceId: pageId,
        resourceIdName: "page_id",
        subId: parts[startIndex + 3],
        subIdName: "property_id"
      };
    }
  }

  if (baseSegment === "blocks") {
    if (parts[startIndex + 1] === "meeting_notes" && parts[startIndex + 2] === "query") {
      return { category, pattern: `${method} ${apiPrefix}/blocks/meeting_notes/query` };
    }
    const blockId = parts[startIndex + 1];
    if (parts.length - startIndex === 2) {
      return {
        category,
        pattern: `${method} ${apiPrefix}/blocks/{block_id}`,
        resourceId: blockId,
        resourceIdName: "block_id"
      };
    }
    if (parts[startIndex + 2] === "children") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/blocks/{block_id}/children`,
        resourceId: blockId,
        resourceIdName: "block_id"
      };
    }
    if (parts[startIndex + 2] === "query") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/blocks/{block_id}/query`,
        resourceId: blockId,
        resourceIdName: "block_id"
      };
    }
  }

  if (baseSegment === "data_sources") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/data_sources` };
    }
    const dsId = parts[startIndex + 1];
    if (parts.length - startIndex === 2) {
      return {
        category,
        pattern: `${method} ${apiPrefix}/data_sources/{data_source_id}`,
        resourceId: dsId,
        resourceIdName: "data_source_id"
      };
    }
    if (parts[startIndex + 2] === "templates") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/data_sources/{data_source_id}/templates`,
        resourceId: dsId,
        resourceIdName: "data_source_id"
      };
    }
    if (parts[startIndex + 2] === "query") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/data_sources/{data_source_id}/query`,
        resourceId: dsId,
        resourceIdName: "data_source_id"
      };
    }
  }

  if (baseSegment === "databases") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/databases` };
    }
    return {
      category,
      pattern: `${method} ${apiPrefix}/databases/{database_id}`,
      resourceId: parts[startIndex + 1],
      resourceIdName: "database_id"
    };
  }

  if (baseSegment === "comments") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/comments` };
    }
    return {
      category,
      pattern: `${method} ${apiPrefix}/comments/{comment_id}`,
      resourceId: parts[startIndex + 1],
      resourceIdName: "comment_id"
    };
  }

  if (baseSegment === "file_uploads") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/file_uploads` };
    }
    const uploadId = parts[startIndex + 1];
    if (parts.length - startIndex === 2) {
      return {
        category,
        pattern: `${method} ${apiPrefix}/file_uploads/{file_upload_id}`,
        resourceId: uploadId,
        resourceIdName: "file_upload_id"
      };
    }
    if (parts[startIndex + 2] === "send") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/file_uploads/{file_upload_id}/send`,
        resourceId: uploadId,
        resourceIdName: "file_upload_id"
      };
    }
    if (parts[startIndex + 2] === "complete") {
      return {
        category,
        pattern: `${method} ${apiPrefix}/file_uploads/{file_upload_id}/complete`,
        resourceId: uploadId,
        resourceIdName: "file_upload_id"
      };
    }
  }

  if (baseSegment === "custom_emojis") {
    return { category, pattern: `${method} ${apiPrefix}/custom_emojis` };
  }

  if (baseSegment === "views") {
    if (parts.length - startIndex === 1) {
      return { category, pattern: `${method} ${apiPrefix}/views` };
    }
    const viewId = parts[startIndex + 1];
    if (parts.length - startIndex === 2) {
      return {
        category,
        pattern: `${method} ${apiPrefix}/views/{view_id}`,
        resourceId: viewId,
        resourceIdName: "view_id"
      };
    }
    if (parts[startIndex + 2] === "queries") {
      if (parts.length - startIndex === 3) {
        return {
          category,
          pattern: `${method} ${apiPrefix}/views/{view_id}/queries`,
          resourceId: viewId,
          resourceIdName: "view_id"
        };
      }
      return {
        category,
        pattern: `${method} ${apiPrefix}/views/{view_id}/queries/{query_id}`,
        resourceId: viewId,
        resourceIdName: "view_id",
        subId: parts[startIndex + 3],
        subIdName: "query_id"
      };
    }
  }

  if (baseSegment === "search") {
    return { category, pattern: `${method} ${apiPrefix}/search` };
  }

  if (baseSegment === "oauth") {
    const sub = parts[startIndex + 1];
    return { category, pattern: `${method} ${apiPrefix}/oauth/${sub || "token"}` };
  }

  let patternParts = parts.slice(startIndex).map((p) => {
    if (isId(p)) return "{id}";
    return p;
  });
  const pattern = `${method} ${apiPrefix}/${patternParts.join("/")}`;
  const firstId = parts.slice(startIndex).find(isId);
  return {
    category,
    pattern,
    resourceId: firstId,
    resourceIdName: firstId ? "id" : undefined
  };
}

function categoryTone(category: string) {
  const c = category.toLowerCase();
  if (c.includes("user")) return "bg-amber-50 text-amber-700 border-amber-200/70";
  if (c.includes("page")) return "bg-emerald-50 text-emerald-700 border-emerald-200/70";
  if (c.includes("block")) return "bg-indigo-50 text-indigo-700 border-indigo-200/70";
  if (c.includes("database")) return "bg-sky-50 text-sky-700 border-sky-200/70";
  if (c.includes("data source")) return "bg-violet-50 text-violet-700 border-violet-200/70";
  if (c.includes("comment")) return "bg-rose-50 text-rose-700 border-rose-200/70";
  if (c.includes("file upload")) return "bg-cyan-50 text-cyan-700 border-cyan-200/70";
  if (c.includes("custom emoji")) return "bg-teal-50 text-teal-700 border-teal-200/70";
  if (c.includes("view")) return "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/70";
  if (c.includes("search")) return "bg-orange-50 text-orange-700 border-orange-200/70";
  if (c.includes("oauth")) return "bg-pink-50 text-pink-700 border-pink-200/70";
  return "bg-zinc-50 text-zinc-700 border-zinc-200/70";
}

function methodBadgeTone(method: string) {
  const m = method.toUpperCase();
  if (m === "GET") return "bg-blue-50 text-blue-700 border-blue-200/70";
  if (m === "POST") return "bg-emerald-50 text-emerald-700 border-emerald-200/70";
  if (m === "PATCH") return "bg-amber-50 text-amber-700 border-amber-200/70";
  if (m === "DELETE") return "bg-red-50 text-red-700 border-red-200/70";
  return "bg-zinc-50 text-zinc-700 border-zinc-200/70";
}

function methodTone(method: string) {
  return method === "GET"
    ? "bg-blue-50 text-blue-700 border-blue-200/70"
    : method === "POST"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
      : "bg-violet-50 text-violet-700 border-violet-200/70";
}

function objectTone(objectType?: string) {
  if (objectType === "database") return "bg-sky-50 text-sky-700 border-sky-200/70";
  if (objectType === "data_source") return "bg-violet-50 text-violet-700 border-violet-200/70";
  if (objectType === "page") return "bg-emerald-50 text-emerald-700 border-emerald-200/70";
  if (objectType === "list") return "bg-zinc-100 text-zinc-700 border-zinc-200";
  return "bg-zinc-800 text-white border-zinc-900";
}

function getSurfaceLabel(log: LogEntry) {
  return log.nameTag ? log.nameTag : formatPath(log.url);
}

function splitTracePath(tracePath?: string) {
  return tracePath?.split("/").map((part) => part.trim()).filter(Boolean) ?? [];
}

function buildTree(logs: LogEntry[]): TreeLogNode[] {
  const tracedLogs = logs.filter((log) => Boolean(log.tracePath));
  if (tracedLogs.length === 0) return buildLegacyTree(logs);

  const roots: TreeLogNode[] = [];
  const byPath = new Map<string, TreeLogNode>();

  const getOrCreateGroup = (pathParts: string[], log: LogEntry): TreeLogNode => {
    const path = pathParts.join("/");
    const existing = byPath.get(path);
    if (existing) {
      existing.sortStamp = Math.min(existing.sortStamp, log.timestamp);
      return existing;
    }

    const node: TreeLogNode = {
      key: path,
      label: pathParts[pathParts.length - 1] ?? path,
      path,
      depth: Math.max(0, pathParts.length - 1),
      isBranch: true,
      sortStamp: log.timestamp,
      children: [],
    };
    byPath.set(path, node);
    if (pathParts.length === 1) roots.push(node);
    return node;
  };

  const attachChild = (parent: TreeLogNode | null, child: TreeLogNode) => {
    if (parent) parent.children.push(child);
    else roots.push(child);
  };

  const updateAncestors = (pathParts: string[], timestamp: number) => {
    for (let index = 1; index <= pathParts.length; index += 1) {
      const ancestor = byPath.get(pathParts.slice(0, index).join("/"));
      if (ancestor) ancestor.sortStamp = Math.min(ancestor.sortStamp, timestamp);
    }
  };

  const sorted = [...tracedLogs].sort((a, b) => a.timestamp - b.timestamp || a.duration - b.duration || a.id.localeCompare(b.id));

  for (const log of sorted) {
    const segments = splitTracePath(log.tracePath);
    if (segments.length === 0) continue;

    const branchSegments = segments.slice(0, -1);
    let parent: TreeLogNode | null = null;

    for (let index = 0; index < branchSegments.length; index += 1) {
      const group = getOrCreateGroup(branchSegments.slice(0, index + 1), log);
      if (parent && !parent.children.includes(group)) parent.children.push(group);
      parent = group;
    }

    const leafPath = segments.join("/");
    const leaf: TreeLogNode = {
      key: `${leafPath}#${log.id}`,
      label: getSurfaceLabel(log),
      path: leafPath,
      depth: segments.length - 1,
      log,
      isBranch: false,
      sortStamp: log.timestamp,
      children: [],
    };
    attachChild(parent, leaf);
    updateAncestors(segments, log.timestamp);
  }

  sortTree(roots);
  return roots;
}

function buildLegacyTree(logs: LogEntry[]): TreeLogNode[] {
  const sorted = logs
    .map((log, index) => ({
      log,
      index,
      start: log.timestamp,
      end: log.timestamp + Math.max(1, log.duration || 0),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);

  const roots: TreeLogNode[] = [];
  const stack: TreeLogNode[] = [];

  for (const entry of sorted) {
    while (stack.length > 0 && stack[stack.length - 1].sortStamp + Math.max(1, stack[stack.length - 1].log?.duration ?? 0) <= entry.start) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const node: TreeLogNode = {
      key: entry.log.id,
      label: getSurfaceLabel(entry.log),
      path: entry.log.id,
      depth: stack.length,
      log: entry.log,
      isBranch: false,
      sortStamp: entry.start,
      children: [],
    };

    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  sortTree(roots);
  return roots;
}

function sortTree(nodes: TreeLogNode[]) {
  nodes.sort((a, b) => a.sortStamp - b.sortStamp || a.label.localeCompare(b.label));
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children);
  }
}

function collectTreeIds(nodes: TreeLogNode[]): string[] {
  const ids: string[] = [];
  const walk = (items: TreeLogNode[]) => {
    for (const node of items) {
      if (node.isBranch) ids.push(node.key);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

function summarizeTree(nodes: TreeLogNode[]) {
  let total = 0;
  let maxDepth = 0;
  let leafCount = 0;
  const walk = (items: TreeLogNode[]) => {
    for (const node of items) {
      total += 1;
      maxDepth = Math.max(maxDepth, node.depth);
      if (!node.isBranch || node.children.length === 0) leafCount += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return { total, maxDepth, leafCount };
}

function LogPill({ children, tone, className = "" }: { children: string; tone: string; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone} ${className}`}>
      {children}
    </span>
  );
}

function formatDetailedLog(log: LogEntry) {
  const lines = [
    `Time: ${formatClock(log.timestamp)}`,
    `Method: ${log.method}`,
    `Status: ${log.status}`,
    `Duration: ${log.duration}ms`,
    `URL: ${log.url}`,
  ];

  if (log.tracePath) lines.push(`Trace: ${log.tracePath}`);
  if (log.nameTag) lines.push(`Label: ${log.nameTag}`);
  if (log.objectType) lines.push(`Type: ${log.objectType}`);

  if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
    lines.push("", "Request Headers:", JSON.stringify(log.requestHeaders, null, 2));
  }
  if (log.requestBody !== undefined) {
    lines.push("", "Request Body:", JSON.stringify(log.requestBody, null, 2));
  }
  if (log.responseBody !== undefined) {
    lines.push("", "Response Body:", JSON.stringify(log.responseBody, null, 2));
  }
  if (log.error) {
    lines.push("", `Error: ${log.error}`);
  }

  return lines.join("\n");
}

function jsonText(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatCurlRequest(log: LogEntry) {
  const parts = [`curl -X ${log.method} ${shellQuote(log.url)}`];
  for (const [key, value] of Object.entries(log.requestHeaders ?? {})) {
    parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }
  if (log.requestBody !== undefined) {
    parts.push(`  --data ${shellQuote(jsonText(log.requestBody))}`);
  }
  return parts.join(" \\\n");
}

function formatResponseJson(log: LogEntry) {
  return jsonText({
    status: log.status,
    error: log.error,
    body: log.responseBody ?? null,
  });
}

function formatSurfaceLog(log: LogEntry) {
  const time = formatClock(log.timestamp);
  const cleanUrl = formatPath(log.url);
  const nameInfo = log.nameTag
    ? `"${log.nameTag}"${log.objectType ? ` (${log.objectType})` : ''}`
    : (log.objectType ? `(${log.objectType})` : '');

  return `[${time}] ${log.method.padEnd(4)} ${log.status} - ${nameInfo ? nameInfo + ' - ' : ''}${cleanUrl} (${log.duration}ms)`;
}

function formatErrorLogs(logs: LogEntry[]) {
  return logs
    .filter((log) => log.status >= 400 || Boolean(log.error))
    .map((log) => [
      "=== ERROR ===",
      formatDetailedLog(log),
    ].join("\n"))
    .join("\n\n");
}

function TreeBranch({
  node,
  collapsedIds,
  expandedId,
  onToggleCollapsed,
  onToggleExpanded,
  onCopyRequest,
  onCopyResponse,
  copiedRequestId,
  copiedResponseId,
}: {
  node: TreeLogNode;
  collapsedIds: Set<string>;
  expandedId: string | null;
  onToggleCollapsed: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onCopyRequest: (log: LogEntry) => void;
  onCopyResponse: (log: LogEntry) => void;
  copiedRequestId: string | null;
  copiedResponseId: string | null;
}) {
  const isCollapsed = collapsedIds.has(node.key);
  const isExpanded = node.log ? expandedId === node.log.id : false;
  const isError = node.log ? node.log.status >= 400 : false;
  const hasChildren = node.children.length > 0;

  return (
    <div className={node.depth === 0 ? "" : "relative pl-6"}>
      {node.depth > 0 && (
        <>
          <span className="absolute left-3 top-0 bottom-0 w-px bg-zinc-200" />
          <span className={`absolute left-[7.5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white ${isError ? "bg-red-500" : node.isBranch ? "bg-sky-500" : "bg-emerald-500"}`} />
        </>
      )}

      {node.log ? (
        <div className={`overflow-hidden rounded-lg border shadow-sm transition-all ${
          isError ? "border-red-200 ring-1 ring-red-50 bg-white" :
          isExpanded ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 hover:border-zinc-300 bg-white"
        }`}>
          <div className="flex items-start gap-1.5 px-3 py-1.5">
            <button
              type="button"
              onClick={() => hasChildren && onToggleCollapsed(node.key)}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                hasChildren 
                  ? isExpanded
                    ? "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    : "border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700 text-zinc-500"
                  : "border-transparent opacity-30 text-zinc-500"
              }`}
              title={hasChildren ? (isCollapsed ? "Expand branch" : "Collapse branch") : "No nested requests"}
            >
              {hasChildren ? (isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <span className="h-3 w-3" />}
            </button>

            <button
              type="button"
              onClick={() => onToggleExpanded(node.log!.id)}
              className={`flex min-w-0 flex-1 flex-col gap-1 text-left transition-colors ${isExpanded ? 'text-zinc-200' : 'text-zinc-900'}`}
            >
              {(() => {
                const parsed = parseEndpointPattern(node.log!.method, node.log!.url);
                return (
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 w-full">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {/* Method badge */}
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${methodBadgeTone(node.log!.method)}`}>
                        {node.log!.method}
                      </span>

                      {/* Status badge */}
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                        isError ? 'bg-red-100 text-red-700 border-red-200' :
                        node.log!.status === 0 ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse' :
                        'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {node.log!.status === 0 ? "PENDING" : node.log!.status}
                      </span>

                      {/* Category badge */}
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${categoryTone(parsed.category)}`}>
                        {parsed.category}
                      </span>

                      {/* Endpoint pattern */}
                      <code className={`text-[10px] font-mono border px-1.5 py-0.5 rounded whitespace-nowrap ${
                        isExpanded 
                          ? 'bg-zinc-900 text-zinc-300 border-zinc-800' 
                          : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                      }`}>
                        {parsed.pattern}
                      </code>
                    </div>

                    {/* Target resource name and ID */}
                    <div className="flex flex-col md:items-end md:text-right md:ml-auto min-w-0 text-xs">
                      {node.log!.nameTag && node.log!.nameTag !== formatPath(node.log!.url) ? (
                        <>
                          <span className={`font-bold truncate max-w-[250px] ${isExpanded ? 'text-zinc-200' : 'text-zinc-800'}`} title={node.log!.nameTag}>
                            {node.log!.nameTag}
                          </span>
                          {parsed.resourceId && (
                            <span className={`font-mono text-[9px] truncate max-w-[200px] ${isExpanded ? 'text-zinc-500' : 'text-zinc-400'}`}>
                              {parsed.resourceIdName}: {parsed.resourceId}
                            </span>
                          )}
                        </>
                      ) : parsed.resourceId ? (
                        <span className={`font-mono text-[10px] font-semibold truncate max-w-[250px] ${isExpanded ? 'text-zinc-300' : 'text-zinc-700'}`}>
                          {parsed.resourceIdName}: {parsed.resourceId}
                        </span>
                      ) : (
                        <span className={`italic ${isExpanded ? 'text-zinc-600' : 'text-zinc-500'}`}>No Target ID</span>
                      )}
                    </div>

                    {/* Duration and timestamp */}
                    <div className={`flex shrink-0 items-center gap-2 text-[10px] self-end md:self-auto ${isExpanded ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      <span className={`rounded px-1 py-0 font-mono text-[9px] tabular-nums ${isExpanded ? 'bg-zinc-900 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>{node.log!.duration}ms</span>
                      <span>{formatClock(node.log!.timestamp)}</span>
                    </div>
                  </div>
                );
              })()}
            </button>
          </div>

          {isExpanded && (
            <div className="border-t border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-1.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Request</h4>
                    <button type="button" onClick={() => onCopyRequest(node.log!)} className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10">
                      {copiedRequestId === node.log.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} Copy request
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded border border-white/5 bg-black/50 p-2 font-mono text-[10px]">
                    <div className="mb-1 text-blue-400">{node.log.method} {node.log.url}</div>
                    {node.log.requestHeaders && Object.entries(node.log.requestHeaders).map(([key, value]) => (
                      <div key={key}><span className="text-zinc-500">{key}:</span> <span className="text-green-300">{value}</span></div>
                    ))}
                    {node.log.requestBody && (
                       <div className="mt-2 border-t border-white/10 pt-2 text-zinc-300">
                         <pre className="max-h-[500px] overflow-auto bg-zinc-950 p-6 text-xs font-mono leading-relaxed text-zinc-100 rounded-md border border-white/5">
                           <code><HighlightedCode text={JSON.stringify(node.log.requestBody, null, 2)} /></code>
                         </pre>
                       </div>
                     )}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-1.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Response JSON</h4>
                    <button type="button" onClick={() => onCopyResponse(node.log!)} className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10">
                      {copiedResponseId === node.log.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} Copy response
                    </button>
                  </div>
                  <pre className="max-h-[500px] overflow-auto bg-zinc-950 p-6 text-xs font-mono leading-relaxed text-zinc-100 rounded-md border border-white/5">
                    <code><HighlightedCode text={formatResponseJson(node.log)} /></code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white/80 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => hasChildren && onToggleCollapsed(node.key)}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-zinc-500 transition-colors ${hasChildren ? "border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700" : "border-transparent opacity-30"}`}
              title={hasChildren ? (isCollapsed ? "Expand branch" : "Collapse branch") : "No nested requests"}
            >
              {hasChildren ? (isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />) : <span className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-800">{node.label}</div>
              <div className="text-xs text-zinc-500">Branch {node.path}</div>
            </div>
          </div>
        </div>
      )}

      {hasChildren && !isCollapsed && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <TreeBranch
              key={child.key}
              node={child}
              collapsedIds={collapsedIds}
              expandedId={expandedId}
              onToggleCollapsed={onToggleCollapsed}
              onToggleExpanded={onToggleExpanded}
              onCopyRequest={onCopyRequest}
              onCopyResponse={onCopyResponse}
              copiedRequestId={copiedRequestId}
              copiedResponseId={copiedResponseId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DebugModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DebugViewMode>("chronological");
  const [collapsedTreeIds, setCollapsedTreeIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copiedErrors, setCopiedErrors] = useState(false);
  const [copyMode, setCopyMode] = useState<LogCopyMode>("surface");
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [copiedResponseId, setCopiedResponseId] = useState<string | null>(null);
  const clearedAtRef = useRef(0);
  const latestFetchIdRef = useRef(0);

  const treeRoots = useMemo(() => buildTree(logs), [logs]);
  const treeSummary = useMemo(() => summarizeTree(treeRoots), [treeRoots]);
  const treeIds = useMemo(() => collectTreeIds(treeRoots), [treeRoots]);

  const toggleCollapsedTreeId = (id: string) => {
    setCollapsedTreeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const collapseAllBranches = () => {
    setCollapsedTreeIds(new Set(treeIds));
  };

  const expandAllBranches = () => {
    setCollapsedTreeIds(new Set());
  };

  const toggleExpandedLog = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const handleCopySurfaceLogs = async () => {
    if (logs.length === 0) return;
    
    const text = copyMode === "surface"
      ? logs.map(formatSurfaceLog).join('\n')
      : logs.map(formatDetailedLog).join('\n\n---\n\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy surface logs", err);
    }
  };

  const handleCopyRequest = async (log: LogEntry) => {
    try {
      await navigator.clipboard.writeText(formatCurlRequest(log));
      setCopiedRequestId(log.id);
      setTimeout(() => setCopiedRequestId(null), 2000);
    } catch (err) {
      console.error("Failed to copy request", err);
    }
  };

  const handleCopyResponse = async (log: LogEntry) => {
    try {
      await navigator.clipboard.writeText(formatResponseJson(log));
      setCopiedResponseId(log.id);
      setTimeout(() => setCopiedResponseId(null), 2000);
    } catch (err) {
      console.error("Failed to copy response", err);
    }
  };

  const handleCopyErrors = async () => {
    const errorText = formatErrorLogs(logs);
    if (!errorText) return;

    try {
      await navigator.clipboard.writeText(errorText);
      setCopiedErrors(true);
      setTimeout(() => setCopiedErrors(false), 2000);
    } catch (err) {
      console.error("Failed to copy error logs", err);
    }
  };

  const fetchLogs = async (isAutoRefresh = false) => {
    const fetchId = ++latestFetchIdRef.current;
    if (!isAutoRefresh) setLoading(true);
    try {
      const res = await fetch(`/api/notion/debug?_t=${Date.now()}`);
      if (res.ok && fetchId === latestFetchIdRef.current) {
        const data = (await res.json()) as LogEntry[];
        const nextLogs = clearedAtRef.current > 0
          ? data.filter((log) => log.timestamp >= clearedAtRef.current)
          : data;
        setLogs(nextLogs);
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      if (fetchId === latestFetchIdRef.current) {
        if (!isAutoRefresh) setLoading(false);
      }
    }
  };

  const clearLogs = async () => {
    try {
      clearedAtRef.current = Date.now();
      setLogs([]);
      setExpandedId(null);
      setCollapsedTreeIds(new Set());
      await fetch("/api/notion/debug", { method: "DELETE" });
      void fetchLogs();
    } catch (err) {
      console.error("Failed to clear logs", err);
    }
  };

  useEffect(() => {
    if (open) {
      clearedAtRef.current = 0;
      fetchLogs();

      const intervalId = setInterval(() => {
        void fetchLogs(true);
      }, 1000);

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        clearInterval(intervalId);
      };
    }
  }, [open, onClose]);

  useEffect(() => {
    if (viewMode === "tree") {
      setCollapsedTreeIds((current) => {
        const next = new Set([...current].filter((id) => treeIds.includes(id)));
        return next;
      });
    }
  }, [treeIds, viewMode]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative flex h-full max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-zinc-200">
              <Activity className="h-5 w-5 text-zinc-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">API Raw Tracking</h2>
              <p className="text-xs text-zinc-500">Chronological feed plus an inferred branch tree for recursive fetches</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {logs.length > 0 && (
              <>
                <div className="flex items-center rounded-md border border-zinc-200 bg-zinc-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setCopyMode("surface")}
                    className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${copyMode === "surface" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
                    title="Copy title-only surface logs"
                  >
                    Surface
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyMode("full")}
                    className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${copyMode === "full" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
                    title="Copy logs with request, response, and context"
                  >
                    Full
                  </button>
                </div>
                <button 
                  onClick={handleCopySurfaceLogs}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 active:bg-zinc-200 transition-all shadow-sm"
                  title={copyMode === "surface" ? "Copy title-only logs" : "Copy full logs with all context"}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      <span className="text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 text-zinc-500" />
                      <span>{copyMode === "surface" ? "Copy Logs" : "Copy Full"}</span>
                    </>
                  )}
                </button>
                <button 
                  onClick={handleCopyErrors}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 active:bg-red-200 transition-all shadow-sm"
                  title="Copy only error logs with detailed request and response data"
                >
                  {copiedErrors ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      <span className="text-emerald-700">Copied errors!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 text-red-500" />
                      <span>Copy Errors</span>
                    </>
                  )}
                </button>
              </>
            )}
            <button 
              onClick={() => void fetchLogs()}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button 
              onClick={clearLogs}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </button>
            <div className="h-6 w-px bg-zinc-200 mx-1"></div>
            <button onClick={onClose} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-zinc-50/30 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 rounded-full bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => setViewMode("chronological")}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "chronological" ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                Chronological
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tree")}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === "tree" ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-500 hover:text-zinc-800"}`}
              >
                Tree
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {viewMode === "tree" && logs.length > 0 && (
                <>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">Roots {treeRoots.length}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-700">Nodes {treeSummary.total}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-700">Leaves {treeSummary.leafCount}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-700">Max depth {treeSummary.maxDepth}</span>
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">Errors {logs.filter((log) => log.status >= 400).length}</span>
                  <button
                    type="button"
                    onClick={expandAllBranches}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllBranches}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
                  >
                    Collapse all
                  </button>
                </>
              )}
              {viewMode === "tree" && logs.length > 0 && (
                <span className="rounded-full bg-zinc-50 px-2.5 py-1 font-medium text-zinc-500">
                  Branches are inferred from request timing. Expand a parent to follow the recursive path.
                </span>
              )}
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <TerminalSquare className="mb-4 h-12 w-12 text-zinc-300" />
              <h3 className="text-sm font-medium text-zinc-900">No logs yet</h3>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Perform an action like fetching a URL or exporting to see the raw API calls appear here.
              </p>
            </div>
          ) : viewMode === "chronological" ? (
            <div className="space-y-2">
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                const isError = log.status >= 400;

                return (
                  <div key={log.id} className={`overflow-hidden rounded-lg border shadow-sm transition-all ${
                    isError ? 'border-red-200 ring-1 ring-red-50 bg-white' : 
                    isExpanded ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 hover:border-zinc-300 bg-white'
                  }`}>
                    <button
                      onClick={() => toggleExpandedLog(log.id)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors ${
                        isExpanded ? 'hover:bg-zinc-900/50 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-900'
                      }`}
                      type="button"
                    >
                      {(() => {
                        const parsed = parseEndpointPattern(log.method, log.url);
                        return (
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 w-full">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              {/* Toggle indicator */}
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}

                              {/* Method badge */}
                              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${methodBadgeTone(log.method)}`}>
                                {log.method}
                              </span>

                              {/* Status badge */}
                              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold ${
                                isError ? 'bg-red-100 text-red-700 border-red-200' :
                                log.status === 0 ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse' :
                                'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}>
                                {log.status === 0 ? "PENDING" : log.status}
                              </span>

                              {/* Category badge */}
                              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${categoryTone(parsed.category)}`}>
                                {parsed.category}
                              </span>

                              {/* Endpoint pattern */}
                              <code className={`text-[10px] font-mono border px-1.5 py-0.5 rounded whitespace-nowrap ${
                                isExpanded 
                                  ? 'bg-zinc-900 text-zinc-300 border-zinc-800' 
                                  : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                              }`}>
                                {parsed.pattern}
                              </code>
                            </div>

                            {/* Target resource name and ID */}
                            <div className="flex flex-col md:items-end md:text-right md:ml-auto min-w-0 text-xs">
                              {log.nameTag && log.nameTag !== formatPath(log.url) ? (
                                <>
                                  <span className={`font-bold truncate max-w-[250px] ${isExpanded ? 'text-zinc-200' : 'text-zinc-800'}`} title={log.nameTag}>
                                    {log.nameTag}
                                  </span>
                                  {parsed.resourceId && (
                                    <span className={`font-mono text-[9px] truncate max-w-[200px] ${isExpanded ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                      {parsed.resourceIdName}: {parsed.resourceId}
                                    </span>
                                  )}
                                </>
                              ) : parsed.resourceId ? (
                                <span className={`font-mono text-[10px] font-semibold truncate max-w-[250px] ${isExpanded ? 'text-zinc-300' : 'text-zinc-700'}`}>
                                  {parsed.resourceIdName}: {parsed.resourceId}
                                </span>
                              ) : (
                                <span className={`italic ${isExpanded ? 'text-zinc-600' : 'text-zinc-500'}`}>No Target ID</span>
                              )}
                            </div>

                            {/* Duration and timestamp */}
                            <div className={`flex shrink-0 items-center gap-2 text-[10px] self-end md:self-auto ${isExpanded ? 'text-zinc-500' : 'text-zinc-500'}`}>
                              <span className={`rounded px-1 py-0 font-mono text-[9px] tabular-nums ${isExpanded ? 'bg-zinc-900 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>{log.duration}ms</span>
                              <span>{formatClock(log.timestamp)}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-1.5">
                              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Request</h4>
                              <button type="button" onClick={() => handleCopyRequest(log)} className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10">
                                {copiedRequestId === log.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} Copy request
                              </button>
                            </div>
                            <div className="overflow-x-auto rounded border border-white/5 bg-black/50 p-2 font-mono text-[10px]">
                              <div className="mb-1 text-blue-400">{log.method} {log.url}</div>
                              {log.requestHeaders && Object.entries(log.requestHeaders).map(([k, v]) => (
                                <div key={k}><span className="text-zinc-500">{k}:</span> <span className="text-green-300">{v}</span></div>
                              ))}
                              {log.requestBody && (
                                <div className="mt-2 border-t border-white/10 pt-2 text-zinc-300">
                                  <pre className="max-h-[500px] overflow-auto bg-zinc-950 p-6 text-xs font-mono leading-relaxed text-zinc-100 rounded-md border border-white/5">
                                    <code><HighlightedCode text={JSON.stringify(log.requestBody, null, 2)} /></code>
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-1.5">
                              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Response JSON</h4>
                              <button type="button" onClick={() => handleCopyResponse(log)} className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10">
                                {copiedResponseId === log.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} Copy response
                              </button>
                            </div>
                            <pre className="max-h-[500px] overflow-auto bg-zinc-950 p-6 text-xs font-mono leading-relaxed text-zinc-100 rounded-md border border-white/5">
                              <code><HighlightedCode text={formatResponseJson(log)} /></code>
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {treeRoots.map((node) => (
                <TreeBranch
                  key={node.key}
                  node={node}
                  collapsedIds={collapsedTreeIds}
                  expandedId={expandedId}
                  onToggleCollapsed={toggleCollapsedTreeId}
                  onToggleExpanded={toggleExpandedLog}
                  onCopyRequest={handleCopyRequest}
                  onCopyResponse={handleCopyResponse}
                  copiedRequestId={copiedRequestId}
                  copiedResponseId={copiedResponseId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
