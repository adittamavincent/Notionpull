"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FinderTree, flattenTree } from "@/components/FinderTree";
import { DatabaseConfigModal } from "@/components/DatabaseConfigModal";
import { ExportModal } from "@/components/ExportModal";
import { ExportProgress } from "@/components/ExportProgress";
import { TokenManager } from "@/components/TokenManager";
import { type ExportItem } from "@/lib/export";
import { extractNotionIds, firstTitleProperty } from "@/lib/notion";
import { getActiveTokenLabel, getTokens } from "@/lib/tokens";
import type { DetectedObject, NotionBlock, NotionPage, NotionTokenEntry, RowsResponse, TreeNodeData } from "@/types/notion";
import { History, RefreshCw, LogOut } from "lucide-react";

type DepthOption = "1" | "2" | "3" | "All";

const depthOptions: DepthOption[] = ["1", "2", "3", "All"];

export default function Page() {
  const [tokens, setTokens] = useState<NotionTokenEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  
  const [url, setUrl] = useState("");
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  
  const [detected, setDetected] = useState<DetectedObject | null>(null);
  const [nodes, setNodes] = useState<TreeNodeData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
  // Requirement: Default depth 1
  const [depth, setDepth] = useState<DepthOption>("1");
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState("");
  
  // Database Config State
  const [configNode, setConfigNode] = useState<TreeNodeData | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // Export Progress State
  const [exporting, setExporting] = useState(false);
  const [exportTotal, setExportTotal] = useState(0);
  const [exportCurrent, setExportCurrent] = useState(0);
  
  // Export Modal State
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());

  // Caching
  const treeCache = useRef<Map<string, TreeNodeData>>(new Map());
  const titleCache = useRef<Map<string, string>>(new Map());

  useEffect(() => refreshTokens(), []);

  // Load URL History from LocalStorage
  useEffect(() => {
    try {
      const history = JSON.parse(localStorage.getItem("notionpull_history") || "[]");
      setUrlHistory(history);
    } catch {}
  }, []);

  const saveUrlHistory = (newUrl: string) => {
    try {
      const hist = JSON.parse(localStorage.getItem("notionpull_history") || "[]");
      const updated = [newUrl, ...hist.filter((u: string) => u !== newUrl)].slice(0, 5);
      localStorage.setItem("notionpull_history", JSON.stringify(updated));
      setUrlHistory(updated);
    } catch {}
  };

  const activeToken = useMemo(() => tokens.find((token) => token.label === activeLabel) ?? null, [tokens, activeLabel]);
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  const selectedNodes = useMemo(() => flatNodes.filter((node) => selected.has(node.id)), [flatNodes, selected]);

  function refreshTokens() {
    const nextTokens = getTokens();
    const nextActive = getActiveTokenLabel() ?? nextTokens[0]?.label ?? null;
    setTokens(nextTokens);
    setActiveLabel(nextActive);
  }

  async function submitUrl(event: FormEvent) {
    event.preventDefault();
    if (!activeToken || !url.trim()) return;
    setError("");
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    
    saveUrlHistory(url.trim());
    
    try {
      const ids = extractNotionIds(url);
      if (!ids.length) throw new Error("Could not find a valid Notion ID in that URL.");
      let lastError: unknown;
      for (const id of ids) {
        try {
          const object = await apiFetch<DetectedObject>(activeToken.token, `/api/notion/detect?id=${encodeURIComponent(id)}`);
          setDetected(object);
          await loadTree(object, depth);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadTree(object: DetectedObject | null = detected, currentDepth: DepthOption = depth, forceRefresh = false) {
    if (!activeToken || !object) return;
    setLoadingTree(true);
    setError("");
    
    const cacheKey = `${object.id}-${currentDepth}`;
    
    if (!forceRefresh && treeCache.current.has(cacheKey)) {
      setNodes([treeCache.current.get(cacheKey)!]);
      setLoadingTree(false);
      return;
    }
    
    // Clear selection if it's a completely new root (not just depth change)
    if (!detected || detected.id !== object.id) {
      setSelected(new Set());
    }
    
    try {
      const maxDepth = currentDepth === "All" ? Infinity : Number(currentDepth);
      const root = await buildNode(activeToken.token, {
        id: object.id,
        title: object.title,
        kind: object.type,
        depth: 0,
        dataSourceId: object.dataSourceId,
        columns: object.columns
      }, maxDepth);
      
      treeCache.current.set(cacheKey, root);
      setNodes([root]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    if (detected && activeToken) {
      void loadTree(detected, depth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  function handleRefresh() {
    if (!detected) return;
    const cacheKey = `${detected.id}-${depth}`;
    treeCache.current.delete(cacheKey);
    void loadTree(detected, depth, true);
  }

  function toggleNode(node: TreeNodeData, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const related = flattenTree([node]).map((item) => item.id);
      for (const id of related) checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(flatNodes.map((node) => node.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function handleConfigureDatabase(node: TreeNodeData) {
    setConfigNode(node);
    setConfigOpen(true);
  }

  function saveDatabaseConfig(nodeId: string, selectedColumns: string[]) {
    // Update the node in the current tree structure
    const updateNode = (list: TreeNodeData[]): TreeNodeData[] => {
      return list.map(n => {
        if (n.id === nodeId) {
          return { ...n, selectedColumns };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    };
    
    const updatedNodes = updateNode(nodes);
    setNodes(updatedNodes);
    
    // Also update cache so it persists across depth changes
    if (detected) {
      const cacheKey = `${detected.id}-${depth}`;
      if (treeCache.current.has(cacheKey)) {
        treeCache.current.set(cacheKey, updatedNodes[0]);
      }
    }
  }

  async function runExport() {
    if (!activeToken || !selectedNodes.length) return;
    setExporting(true);
    setError("");
    
    setExportTotal(selectedNodes.length);
    setExportCurrent(0);
    
    try {
      const items: ExportItem[] = [];
      let current = 0;
      
      for (const node of selectedNodes) {
        if (node.error) {
          current++;
          setExportCurrent(current);
          continue;
        }
        
        if (node.kind === "database" || node.kind === "data_source") {
          const database = node.dataSourceId && node.columns
            ? { dataSourceId: node.dataSourceId, columns: node.columns }
            : await apiFetch<{ dataSourceId: string; columns?: string[] }>(activeToken.token, `/api/notion/database/${node.id}`);
          const allRows = node.children?.length ? await fetchAllRows(activeToken.token, database.dataSourceId) : [];
          let exportRows = allRows;
          
          // If rows are loaded in the tree (depth >= 2), filter by what's checked
          if (node.children && node.children.length > 0) {
            const selectedRowIds = new Set(node.children.filter(c => selected.has(c.id)).map(c => c.id));
            exportRows = allRows.filter(row => selectedRowIds.has(row.id));
          }
          
          items.push({ 
            kind: node.kind, 
            title: node.title, 
            rows: exportRows, 
            columns: database.columns ?? node.columns,
            selectedColumns: node.selectedColumns 
          });
        } else {
          let blocks: NotionBlock[] = [];
          if (shouldFetchPageContent(node, depth)) {
            try {
              blocks = (await apiFetch<{ results: NotionBlock[] }>(activeToken.token, `/api/notion/page/${node.id}/content`)).results;
            } catch {
              blocks = [];
            }
          }
          
          // Avoid redundant exports: if it's a row with no internal content, 
          // and its parent database is already selected (meaning it's in the table), skip it.
          if (node.kind === "row" && !shouldFetchPageContent(node, depth) && node.parentId && selected.has(node.parentId)) {
            // Skip
          } else {
            items.push({ kind: node.kind, title: node.title, page: node.page, blocks });
          }
        }
        
        current++;
        setExportCurrent(current);
      }
      
      const titleById = await buildExportTitleMap(activeToken.token, items, flatNodes, titleCache.current);
      
      setTitleMap(titleById);
      setExportItems(items);
      
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTimeout(() => setExporting(false), 500); // Small delay so user sees 100% completion
    }
  }

  function clearWork() {
    setUrl("");
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    setExportItems([]);
    setError("");
  }

  return (
    <main className="min-h-screen pb-24 bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Notionpull</h1>
            <p className="text-xs font-medium text-zinc-500">{activeToken?.workspaceName ?? "No active workspace"}</p>
          </div>
          <button className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 transition" onClick={() => setManagerOpen(true)}>
            Tokens
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        {!activeToken ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="max-w-md rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 mb-4">
                <LogOut className="h-6 w-6 text-zinc-600" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-900">Add Notion token</h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed">Save your workspace integration token to start fetching and exporting content.</p>
              <button className="mt-6 w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 transition" onClick={() => setManagerOpen(true)}>
                Manage Tokens
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <form className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" onSubmit={submitUrl}>
              <label className="mb-2.5 block text-sm font-medium text-zinc-900">Paste a Notion page or database URL</label>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3.5 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.notion.so/..."
                />
                <button className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:bg-zinc-400" disabled={loadingTree || !url.trim()}>
                  Fetch
                </button>
              </div>
              
              {urlHistory.length > 0 && !detected && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <History className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs text-zinc-500">Recent:</span>
                  {urlHistory.map((hUrl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setUrl(hUrl)}
                      className="max-w-[200px] truncate rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-100"
                      title={hUrl}
                    >
                      {hUrl}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detected && <span className="rounded bg-zinc-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-700 shadow-sm">{detected.type.replace("_", " ")} · {detected.title}</span>}
                {error && <span className="rounded bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 border border-red-100">{error}</span>}
              </div>
            </form>

            {detected && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex rounded-md border border-zinc-300 bg-white p-1 shadow-sm">
                    {depthOptions.map((option) => (
                      <button
                        key={option}
                        className={`rounded px-3 py-1 text-sm font-medium transition-colors ${depth === option ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100"}`}
                        onClick={() => setDepth(option)}
                      >
                        Depth: {option}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={handleRefresh}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50"
                    title="Refresh data"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingTree ? 'animate-spin text-zinc-900' : ''}`} />
                  </button>
                </div>
                
                <div className="flex gap-2">
                  <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50" onClick={selectAll} disabled={!flatNodes.length}>Select All</button>
                  <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50" onClick={deselectAll} disabled={!flatNodes.length}>Deselect All</button>
                </div>
              </div>
            )}

            {detected && (
              <FinderTree 
                nodes={nodes} 
                selected={selected} 
                loading={loadingTree} 
                onToggle={toggleNode} 
                onConfigureDatabase={handleConfigureDatabase}
              />
            )}
          </div>
        )}
      </div>

      {activeToken && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/90 backdrop-blur-md px-5 py-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-700">
              <span className="inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-zinc-900 mr-1.5">{selected.size}</span>
              items selected
            </div>
            <button className="rounded-md bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-zinc-800 hover:shadow-lg disabled:bg-zinc-400" onClick={runExport} disabled={exporting}>
              Export Data
            </button>
          </div>
        </div>
      )}

      <TokenManager open={managerOpen} tokens={tokens} activeLabel={activeLabel} onClose={() => setManagerOpen(false)} onChange={refreshTokens} />
      
      <DatabaseConfigModal 
        open={configOpen} 
        token={activeToken?.token}
        node={configNode} 
        onClose={() => setConfigOpen(false)} 
        onSave={saveDatabaseConfig} 
      />

      <ExportProgress 
        open={exporting} 
        total={exportTotal} 
        current={exportCurrent} 
      />

      <ExportModal 
        open={exportItems.length > 0 && !exporting} 
        items={exportItems} 
        titleById={titleMap} 
        onClose={() => setExportItems([])} 
        onClear={clearWork} 
      />
    </main>
  );
}

// Data Fetching logic (kept same except TreeNodeData modifications)

async function buildNode(token: string, node: TreeNodeData, maxDepth: number): Promise<TreeNodeData> {
  try {
    if (node.kind === "page" || node.kind === "row") {
      if (node.depth >= maxDepth) return node;
      const body = await apiFetch<{ results: Array<{ id: string; type: "page" | "database"; title: string }> }>(token, `/api/notion/page/${node.id}/children`);
      node.children = await Promise.all(body.results.map((child) => buildNode(token, {
        id: child.id,
        title: child.title,
        kind: child.type,
        depth: node.depth + 1,
        parentId: node.id
      }, maxDepth)));
    }
    if (node.kind === "database") {
      const database = await apiFetch<{ dataSourceId: string; title: string; columns?: string[] }>(token, `/api/notion/database/${node.id}`);
      node.dataSourceId = database.dataSourceId;
      node.columns = database.columns ?? node.columns;
      if (node.depth + 1 > maxDepth) return node;
      const rows = await rowNodes(token, database.dataSourceId, node.depth + 1, node.id);
      node.children = await Promise.all(rows.map((row) => buildNode(token, row, maxDepth)));
    }
    if (node.kind === "data_source") {
      if (node.depth + 1 > maxDepth) return node;
      const rows = await rowNodes(token, node.dataSourceId ?? node.id, node.depth + 1, node.id);
      node.children = await Promise.all(rows.map((row) => buildNode(token, row, maxDepth)));
    }
  } catch (err) {
    node.error = errorMessage(err);
  }
  return node;
}

async function rowNodes(token: string, dataSourceId: string, depth: number, parentId: string): Promise<TreeNodeData[]> {
  const rows = await fetchAllRows(token, dataSourceId);
  return rows.map((row) => ({
    id: row.id,
    title: firstTitleProperty(row),
    kind: "row",
    depth,
    parentId,
    page: row
  }));
}

async function fetchAllRows(token: string, dataSourceId: string): Promise<NotionPage[]> {
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const body = await apiFetch<RowsResponse>(token, `/api/notion/datasource/${dataSourceId}/rows${qs}`);
    rows.push(...body.results);
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return rows;
}

async function apiFetch<T>(token: string, url: string, attempt = 0): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-notion-token": token } });
  } catch {
    throw new Error("Could not reach Notion — check your connection");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return apiFetch<T>(token, url, attempt + 1);
  }
  if (!response.ok) throw new Error(mapHttpError(response.status, body.error));
  return body as T;
}

function mapHttpError(status: number, detail?: string): string {
  if (status === 401) return "Token invalid or expired — check your Notion token";
  if (status === 404) return "Not found — make sure the integration has access to this page (Share → Invite integration)";
  if (status === 429) return "Rate limited — waiting 2 seconds...";
  return detail ?? "Unexpected error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function shouldFetchPageContent(node: TreeNodeData, currentDepth: DepthOption): boolean {
  if (node.kind === "row") {
    if (currentDepth === "All") return true;
    return Number(currentDepth) > node.depth;
  }
  return true;
}

async function buildExportTitleMap(token: string, items: ExportItem[], nodes: TreeNodeData[], cache: Map<string, string>): Promise<Map<string, string>> {
  const titleById = new Map(cache);
  for (const node of nodes) setKnownTitle(titleById, cache, node.id, node.title);
  for (const item of items) {
    if (isDatabaseExportItem(item)) {
      for (const row of item.rows) {
        setKnownTitle(titleById, cache, row.id, firstTitleProperty(row));
        collectPropertyObjectIds(row.properties, titleById);
      }
    } else if (item.page) {
      setKnownTitle(titleById, cache, item.page.id, firstTitleProperty(item.page));
      collectPropertyObjectIds(item.page.properties, titleById);
    }
  }

  const missingIds = Array.from(titleById.entries()).filter(([, title]) => !title).map(([id]) => id);
  await Promise.all(missingIds.map(async (id) => {
    try {
      const object = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(id)}`);
      titleById.set(id, object.title);
      cache.set(id, object.title);
    } catch {
      titleById.set(id, "");
    }
  }));
  return titleById;
}

function setKnownTitle(titleById: Map<string, string>, cache: Map<string, string>, id: string, title: string) {
  if (!title) return;
  titleById.set(id, title);
  cache.set(id, title);
}

function collectPropertyObjectIds(properties: Record<string, any> | undefined, titleById: Map<string, string>) {
  for (const prop of Object.values(properties ?? {})) collectObjectIds(prop, titleById);
}

function collectObjectIds(value: any, titleById: Map<string, string>) {
  if (!value || typeof value !== "object") return;
  if (value.type === "relation") {
    for (const relation of value.relation ?? []) {
      if (relation.id && !titleById.has(relation.id)) titleById.set(relation.id, "");
    }
  }
  if (value.type === "url") {
    for (const id of extractNotionIds(value.url ?? "")) {
      if (!titleById.has(id)) titleById.set(id, "");
    }
  }
  if (value.type === "rollup" && value.rollup?.type === "array") {
    for (const item of value.rollup.array ?? []) collectObjectIds(item, titleById);
  }
  if (value.type === "formula" && value.formula?.type === "string") {
    for (const id of extractNotionIds(value.formula.string ?? "")) {
      if (!titleById.has(id)) titleById.set(id, "");
    }
  }
}

function isDatabaseExportItem(item: ExportItem): item is Extract<ExportItem, { rows: NotionPage[] }> {
  return item.kind === "database" || item.kind === "data_source";
}
