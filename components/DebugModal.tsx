import { useEffect, useMemo, useRef, useState } from "react";
import { X, Activity, RefreshCw, Trash2, ChevronRight, ChevronDown, TerminalSquare, Copy, Check } from "lucide-react";
import type { LogEntry } from "@/lib/logger";

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
  return new Date(timestamp).toISOString().split("T")[1].replace("Z", "");
}

function formatPath(url: string) {
  return url.replace("https://api.notion.com/v1", "");
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
        <div className={`overflow-hidden rounded-lg border bg-white shadow-sm transition-all ${isError ? "border-red-200 ring-1 ring-red-50" : "border-zinc-200 hover:border-zinc-300"}`}>
          <div className="flex items-start gap-1.5 px-3 py-1.5">
            <button
              type="button"
              onClick={() => hasChildren && onToggleCollapsed(node.key)}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-zinc-500 transition-colors ${hasChildren ? "border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700" : "border-transparent opacity-30"}`}
              title={hasChildren ? (isCollapsed ? "Expand branch" : "Collapse branch") : "No nested requests"}
            >
              {hasChildren ? (isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <span className="h-3 w-3" />}
            </button>

            <button
              type="button"
              onClick={() => onToggleExpanded(node.log!.id)}
              className="flex min-w-0 flex-1 flex-col gap-1 text-left"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <LogPill tone={methodTone(node.log.method)} className="px-1.5 py-0">{node.log.method}</LogPill>
                <span className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold tabular-nums ${
                  isError ? "border-red-200 bg-red-100 text-red-700" :
                  node.log.status === 0 ? "border-amber-200 bg-amber-50 text-amber-700 animate-pulse" :
                  "border-zinc-200 bg-zinc-100 text-zinc-700"
                }`}>
                  {node.log.status === 0 ? "PENDING" : node.log.status}
                </span>
                {node.log.objectType && (
                  <span className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold ${objectTone(node.log.objectType)}`}>
                    {node.log.objectType}
                  </span>
                )}
                <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0 text-[9px] font-semibold text-zinc-600">
                  {node.path}
                </span>
              </div>

              <div className="min-w-0 text-xs font-semibold text-zinc-800">
                <span className="truncate" title={getSurfaceLabel(node.log)}>
                  {getSurfaceLabel(node.log)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                <span className="rounded bg-zinc-100 px-1 py-0 font-mono text-[9px] tabular-nums">
                  {node.log.duration}ms
                </span>
                <span>{formatClock(node.log.timestamp)}</span>
                <span className="truncate text-zinc-400" title={formatPath(node.log.url)}>
                  {formatPath(node.log.url)}
                </span>
              </div>
            </button>
          </div>

          {isExpanded && (
            <div className="border-t border-zinc-100 bg-zinc-950 p-3 text-xs text-zinc-300">
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
                        <pre>{JSON.stringify(node.log.requestBody, null, 2)}</pre>
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
                  <div className="h-full max-h-[220px] overflow-x-auto rounded border border-white/5 bg-black/50 p-2 font-mono text-[10px]">
                    <pre className={isError ? "text-red-300" : "text-zinc-300"}>{formatResponseJson(node.log)}</pre>
                  </div>
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

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notion/debug?_t=${Date.now()}`);
      if (res.ok) {
        const data = (await res.json()) as LogEntry[];
        const nextLogs = clearedAtRef.current > 0
          ? data.filter((log) => log.timestamp >= clearedAtRef.current)
          : data;
        setLogs(nextLogs);
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      setLoading(false);
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
      const interval = setInterval(fetchLogs, 1000);
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        clearInterval(interval);
        window.removeEventListener("keydown", handleKeyDown);
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
              onClick={fetchLogs}
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
                  <div key={log.id} className={`overflow-hidden rounded-lg border bg-white shadow-sm transition-all ${isError ? 'border-red-200 ring-1 ring-red-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                    <button
                      onClick={() => toggleExpandedLog(log.id)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-zinc-50"
                      type="button"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}

                        <div className={`flex w-12 shrink-0 justify-center rounded px-1.5 py-0 text-[10px] font-bold tracking-wider ${
                          log.method === 'GET' ? 'bg-blue-50 text-blue-700' :
                          log.method === 'POST' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'
                        }`}>
                          {log.method}
                        </div>

                        <div className={`flex w-12 shrink-0 justify-center rounded px-1.5 py-0 text-[9px] font-bold ${
                          isError ? 'bg-red-100 text-red-700' :
                          log.status === 0 ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse' :
                          'bg-zinc-100 text-zinc-700'
                        }`}>
                          {log.status === 0 ? "PENDING" : log.status}
                        </div>

                        <div className="flex items-center gap-1.5 truncate">
                          {log.nameTag && (
                            <span className={`max-w-[200px] shrink-0 truncate rounded border px-1.5 py-0 text-[10px] font-semibold shadow-sm ${
                              log.objectType === 'database'
                                ? 'border-blue-200/50 bg-blue-50 text-blue-700'
                                : log.objectType === 'data_source'
                                ? 'border-purple-200/50 bg-purple-50 text-purple-700'
                                : log.objectType === 'page'
                                ? 'border-emerald-200/50 bg-emerald-50 text-emerald-700'
                                : log.objectType === 'list'
                                ? 'border-zinc-200 bg-zinc-100 text-zinc-700'
                                : 'border-zinc-900 bg-zinc-800 text-white'
                            }`}>
                              {log.nameTag}
                            </span>
                          )}
                          <div className="truncate text-xs font-semibold text-zinc-700" title={log.url}>
                            {formatPath(log.url)}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-500">
                        <span className="rounded bg-zinc-100 px-1 py-0 font-mono text-[9px]">{log.duration}ms</span>
                        <span>{formatClock(log.timestamp)}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-100 bg-zinc-950 p-3 text-xs text-zinc-300">
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
                                  <pre>{JSON.stringify(log.requestBody, null, 2)}</pre>
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
                            <div className="h-full max-h-[220px] overflow-x-auto rounded border border-white/5 bg-black/50 p-2 font-mono text-[10px]">
                              <pre className={isError ? "text-red-300" : "text-zinc-300"}>{formatResponseJson(log)}</pre>
                            </div>
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
