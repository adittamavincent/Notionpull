"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FinderTree, flattenTree } from "@/components/FinderTree";
import { DatabaseConfigModal } from "@/components/DatabaseConfigModal";
import { ExportModal } from "@/components/ExportModal";
import { ExportProgress } from "@/components/ExportProgress";
import { TokenManager } from "@/components/TokenManager";
import { DebugModal } from "@/components/DebugModal";
import { type ExportItem } from "@/lib/export";
import { extractNotionIds, firstTitleProperty, propertyValue } from "@/lib/notion";
import { getActiveTokenLabel, getTokens } from "@/lib/tokens";
import type { DetectedObject, NotionBlock, NotionPage, NotionTokenEntry, RowsResponse, TreeNodeData } from "@/types/notion";
import { History, RefreshCw, LogOut, X } from "lucide-react";
import Image from "next/image";

type DepthOption = "1" | "2" | "3" | "4" | "5" | "All";

const depthOptions: DepthOption[] = ["1", "2", "3", "4", "5", "All"];

export interface HistoryItem {
  url: string;
  title: string;
  type: string;
}

export default function Page() {
  const [tokens, setTokens] = useState<NotionTokenEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  
  const [url, setUrl] = useState("");
  const [urlHistory, setUrlHistory] = useState<HistoryItem[]>([]);
  
  const [detected, setDetected] = useState<DetectedObject | null>(null);
  const [nodes, setNodes] = useState<TreeNodeData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
  // Requirement: Default depth 1
  const [depth, setDepth] = useState<DepthOption>("1");
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState("");

  const [showRelationIds, setShowRelationIds] = useState(false);

  // Load from localStorage on mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notionpull_show_relation_ids");
      if (saved !== null) {
        setShowRelationIds(saved === "true");
      }
    } catch {}
  }, []);

  const handleShowRelationIdsChange = (val: boolean) => {
    setShowRelationIds(val);
    try {
      localStorage.setItem("notionpull_show_relation_ids", String(val));
    } catch {}
  };

  // Reactively update custom preview node titles when showRelationIds changes
  useEffect(() => {
    setNodes((prevNodes) => {
      const updateTreeTitles = (list: TreeNodeData[]): TreeNodeData[] => {
        return list.map((n) => {
          let updatedChildren = n.children;
          if (updatedChildren) {
            updatedChildren = updatedChildren.map((child) => {
              if (child.kind === "row" && child.page) {
                const page = child.page;
                let newTitle = "";
                if (n.previewColumns && n.previewColumns.length > 0) {
                  newTitle = n.previewColumns
                    .map((col) => propertyValue(page.properties?.[col], { showIdForRelationRollup: showRelationIds }))
                    .filter(Boolean)
                    .join(" · ");
                } else {
                  newTitle = firstTitleProperty(page);
                }
                return { ...child, title: newTitle || "Untitled" };
              }
              return child;
            });
          }
          return {
            ...n,
            children: updatedChildren ? updateTreeTitles(updatedChildren) : undefined,
          };
        });
      };
      return updateTreeTitles(prevNodes);
    });
  }, [showRelationIds]);
  
  // Database Config State
  const [configNode, setConfigNode] = useState<TreeNodeData | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // Export Progress State
  const [exporting, setExporting] = useState(false);
  const [exportTotal, setExportTotal] = useState(0);
  const [exportCurrent, setExportCurrent] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  
  // Export Modal State
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());

  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [relativeTime, setRelativeTime] = useState("");

  // Caching
  const treeCache = useRef<Map<string, TreeNodeData>>(new Map());
  const pageChildrenCache = useRef<Map<string, Promise<PageChildrenResponse>>>(new Map());
  const contentCache = useRef<Map<string, Promise<{ results: NotionBlock[] }>>>(new Map());
  const databaseCache = useRef<Map<string, Promise<DatabaseResponse>>>(new Map());
  const rowsCache = useRef<Map<string, Promise<NotionPage[]>>>(new Map());
  const titleCache = useRef<Map<string, string>>(new Map());
  const treeAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => refreshTokens(), []);

  // Load URL History from LocalStorage
  useEffect(() => {
    try {
      const history = JSON.parse(localStorage.getItem("notionpull_history_v2") || "[]");
      setUrlHistory(history);
    } catch {}
  }, []);

  const saveUrlHistory = (newUrl: string, title?: string, type?: string) => {
    try {
      if (!title || !type) return;
      const hist = JSON.parse(localStorage.getItem("notionpull_history_v2") || "[]");
      const newItem: HistoryItem = { url: newUrl, title, type };
      const updated = [newItem, ...hist.filter((h: HistoryItem) => h.url !== newUrl)].slice(0, 10);
      localStorage.setItem("notionpull_history_v2", JSON.stringify(updated));
      setUrlHistory(updated);
    } catch {}
  };

  const removeUrlHistory = (index: number) => {
    try {
      const updated = [...urlHistory];
      updated.splice(index, 1);
      localStorage.setItem("notionpull_history_v2", JSON.stringify(updated));
      setUrlHistory(updated);
    } catch {}
  };

  const activeToken = useMemo(() => tokens.find((token) => token.label === activeLabel) ?? null, [tokens, activeLabel]);
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  // Use unique set of top-level selected nodes to avoid duplicates when parent and child are both selected
  const selectedNodes = useMemo(() => {
    return flatNodes.filter((node) => {
      if (!selected.has(node.id)) return false;
      
      // The root node is always kept
      if (!node.parentId) return true;
      
      const parentIsSelected = selected.has(node.parentId);
      
      // If the parent is selected:
      if (parentIsSelected) {
        // Databases/data sources are always kept to allow parent pages to dynamically embed them
        if (node.kind === "database" || node.kind === "data_source") return true;
        
        // Pages are kept only if they have selected children in the tree (so they are structural, not leaf links)
        if (node.kind === "page") {
          return node.children?.some(child => selected.has(child.id)) ?? false;
        }
        
        // Rows with selected children (blocks inside the row's page) are kept so their content gets exported.
        // Leaf rows (no selected children) are dropped — their data is already in the parent database table.
        if (node.kind === "row") {
          return node.children?.some(child => selected.has(child.id)) ?? false;
        }
        
        // Blocks are always rendered inline under their parent row/page — never export standalone
        return false;
      }
      
      // If the parent is NOT selected, we always keep the node to ensure it gets exported
      return true;
    });
  }, [flatNodes, selected]);

  useEffect(() => {
    if (!lastFetch) {
      setRelativeTime("");
      return;
    }

    const updateRelative = () => {
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - lastFetch.getTime()) / 1000);

      if (diffInSeconds < 5) setRelativeTime("just now");
      else if (diffInSeconds < 60) setRelativeTime(`${diffInSeconds}s ago`);
      else if (diffInSeconds < 3600) setRelativeTime(`${Math.floor(diffInSeconds / 60)}m ago`);
      else setRelativeTime(`${Math.floor(diffInSeconds / 3600)}h ago`);
    };

    updateRelative();
    const timer = setInterval(updateRelative, 10000);
    return () => clearInterval(timer);
  }, [lastFetch]);

  function refreshTokens() {
    const nextTokens = getTokens();
    const nextActive = getActiveTokenLabel() ?? nextTokens[0]?.label ?? null;
    setTokens(nextTokens);
    setActiveLabel(nextActive);
  }

  async function submitUrl(event: FormEvent) {
    event.preventDefault();
    if (!activeToken || !url.trim()) return;
    treeAbortRef.current?.abort();
    const controller = new AbortController();
    treeAbortRef.current = controller;
    setError("");
    setLoadingTree(true);
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    
    try {
      const ids = extractNotionIds(url);
      if (!ids.length) throw new Error("Could not find a valid Notion ID in that URL.");
      
      let viewId = "";
      try {
        const parsedUrl = new URL(url.trim());
        viewId = parsedUrl.searchParams.get("v") || "";
      } catch {}
      
      // Try all IDs in parallel for faster detection
      const results = await Promise.allSettled(
        ids.map(id => apiFetch<DetectedObject>(activeToken.token, `/api/notion/detect?id=${encodeURIComponent(id)}${viewId ? `&viewId=${encodeURIComponent(viewId)}` : ""}`, { signal: controller.signal }))
      );
      
      const successful = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<DetectedObject> | undefined;
      
      if (successful) {
        setDetected(successful.value);
        saveUrlHistory(url.trim(), successful.value.title, successful.value.type);
        await loadTree(successful.value, depth, false, controller);
      } else {
        // Find the most relevant error
        const firstError = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw firstError?.reason || new Error("Could not detect any Notion object in this URL.");
      }
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
      setLoadingTree(false);
    } finally {
      if (treeAbortRef.current === controller) treeAbortRef.current = null;
    }
  }

  async function loadTree(object: DetectedObject | null = detected, currentDepth: DepthOption = depth, forceRefresh = false, controller?: AbortController) {
    if (!activeToken || !object) return;
    if (!controller) {
      treeAbortRef.current?.abort();
      controller = new AbortController();
      treeAbortRef.current = controller;
    }
    setLoadingTree(true);
    setError("");
    if (forceRefresh) {
      pageChildrenCache.current.clear();
      contentCache.current.clear();
      databaseCache.current.clear();
      rowsCache.current.clear();
      treeCache.current.clear(); // Clear tree structure cache on refresh
    }
    
    const cacheKey = treeCacheKey(object.id, currentDepth, object.viewId);
    
    if (!forceRefresh) {
      const cached = getCachedTreeForDepth(treeCache.current, object.id, currentDepth, object.viewId);
      if (cached) {
        treeCache.current.set(cacheKey, cached);
        setNodes([cached]);
        setLoadingTree(false);
        return;
      }
    }

    // Clear selection if it's a completely new root (not just depth change)
    if (!detected || detected.id !== object.id) {
      setSelected(new Set());
    }
    
    try {
      const maxDepth = currentDepth === "All" ? Infinity : Number(currentDepth);
      const rootSeed: TreeNodeData = {
        id: object.id,
        title: object.title,
        kind: object.type,
        depth: 0,
        viewId: object.viewId,
        views: object.views,
        columnDetails: object.columnDetails,
        dataSourceId: object.dataSourceId,
        dataSourceName: object.dataSourceName,
        columns: object.columns,
        selectedColumns: object.selectedColumns,
        properties: object.properties
      };
      const root = await buildNode(activeToken.token, rootSeed, maxDepth, {
        pageChildren: pageChildrenCache.current,
        databases: databaseCache.current,
        rows: rowsCache.current,
        showIdForRelationRollup: showRelationIds,
        signal: controller.signal
      });
      
      // Reconcile selection: If a node was already selected, make sure its new children follow the selection
      setSelected((prev) => {
        const next = new Set(prev);
        const seen = new Set<string>();
        
        const propagate = (n: TreeNodeData, parentSelected: boolean) => {
          if (seen.has(n.id)) return;
          seen.add(n.id);
          
          const isSelected = parentSelected || next.has(n.id);
          if (isSelected) next.add(n.id);
          
          for (const child of n.children ?? []) {
            propagate(child, isSelected);
          }
        };

        propagate(root, next.has(root.id));
        return next;
      });

      treeCache.current.set(cacheKey, root);
      setNodes([root]);
      setLastFetch(new Date());
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
    } finally {
      if (treeAbortRef.current === controller) treeAbortRef.current = null;
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
    const cacheKey = treeCacheKey(detected.id, depth, detected.viewId);
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

  function saveDatabaseConfig(nodeId: string, selectedColumns: string[], previewColumns?: string[]) {
    // Update the node in the current tree structure
    const updateNode = (list: TreeNodeData[]): TreeNodeData[] => {
      return list.map(n => {
        if (n.id === nodeId) {
          const updatedColumnDetails = n.columnDetails?.map(col => ({
            ...col,
            visible: selectedColumns.includes(col.name)
          }));
          
          let updatedChildren = n.children;
          if (updatedChildren) {
            updatedChildren = updatedChildren.map(child => {
              if (child.kind === "row" && child.page) {
                const page = child.page;
                let newTitle = "";
                if (previewColumns && previewColumns.length > 0) {
                  newTitle = previewColumns
                    .map(col => propertyValue(page.properties?.[col], { showIdForRelationRollup: showRelationIds }))
                    .filter(Boolean)
                    .join(" · ");
                } else {
                  newTitle = firstTitleProperty(page);
                }
                return { ...child, title: newTitle || "Untitled" };
              }
              return child;
            });
          }
          
          return { 
            ...n, 
            selectedColumns, 
            columnDetails: updatedColumnDetails, 
            previewColumns, 
            previewColumn: previewColumns?.[0], // Keep for fallback compatibility
            children: updatedChildren 
          };
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
      const cacheKey = treeCacheKey(detected.id, depth, detected.viewId);
      if (treeCache.current.has(cacheKey)) {
        treeCache.current.set(cacheKey, updatedNodes[0]);
      }
    }
  }

  async function runExport() {
    if (!activeToken || !selectedNodes.length) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting(true);
    setError("");
    
    // Use a granular scale where each selected node is 100 units
    const UNITS_PER_NODE = 100;
    setExportTotal(selectedNodes.length * UNITS_PER_NODE);
    setExportCurrent(0);
    setExportStatus("Initializing...");
    
    try {
      const items: ExportItem[] = [];
      let baseProgress = 0;
      
      for (const node of selectedNodes) {
        setExportStatus(`Fetching ${node.title}...`);
        
        if (node.error) {
          baseProgress += UNITS_PER_NODE;
          setExportCurrent(baseProgress);
          continue;
        }
        
        if (node.kind === "database" || node.kind === "data_source") {
          const containerKind = node.kind === "data_source" ? "data_source" : "database";
          const database = node.dataSourceId && node.columns && node.properties
            ? { dataSourceId: node.dataSourceId, columns: node.columns, properties: node.properties, columnDetails: node.columnDetails }
            : await apiFetch<{ dataSourceId: string; columns?: string[]; properties?: Record<string, any>; columnDetails?: any[] }>(activeToken.token, `/api/notion/database/${node.id}?kind=${encodeURIComponent(containerKind)}`, { signal: controller.signal, onStatus: setExportStatus });
          
          // Estimate number of batches to give granular progress
          // Notion usually fetches in batches of 100
          const estimatedRows = node.children?.length && node.children.length > 0 ? node.children.length : 200;
          const estimatedBatches = Math.max(1, Math.ceil(estimatedRows / 100));
          const unitsPerBatch = Math.floor(UNITS_PER_NODE / (estimatedBatches + 1));

          const rowSourceKind = resolveRowSourceKind(node.id, database.dataSourceId, node.kind);
          const allRows = await memoFetch(rowsCache.current, `${activeToken.token}:rows:${database.dataSourceId}:${rowSourceKind}:${node.viewId ?? ""}`, () => 
            fetchAllRows(activeToken.token, database.dataSourceId, rowSourceKind, node.viewId, (count) => {
                const batchesDone = Math.floor(count / 100);
                const progress = baseProgress + Math.min(UNITS_PER_NODE - 10, batchesDone * unitsPerBatch);
                setExportCurrent(progress);
                setExportStatus(`Loading ${node.title} (${count} rows)...`);
            }, { signal: controller.signal, onStatus: setExportStatus })
          );
            
          let exportRows: NotionPage[] = [];
          
          // Only export rows that are actually loaded and checked/selected in the tree view.
          // If rows are not loaded (due to depth limit) or none are selected, export empty rows.
          if (node.children && node.children.length > 0) {
            const selectedRowIds = new Set(node.children.filter(c => selected.has(c.id)).map(c => c.id));
            exportRows = allRows.filter(row => selectedRowIds.has(row.id));
          }
          
          items.push({ 
            kind: node.kind, 
            id: node.id,
            title: node.title, 
            rows: exportRows, 
            columns: database.columns ?? node.columns,
            selectedColumns: node.selectedColumns,
            columnDetails: database.columnDetails ?? node.columnDetails,
            viewId: node.viewId,
            viewTitle: node.views?.find((view) => view.id === node.viewId)?.title,
            properties: database.properties,
            depth: node.depth + 1
          });
        } else {
          // Page/Row/Block fetching
          // No hard jump to 50%, let the smooth UI logic handle the perceived progress
          
          let blocks: NotionBlock[] = [];
          if (shouldFetchPageContent(node, depth)) {
            try {
              const body = await memoFetch(contentCache.current, `${activeToken.token}:content:${node.id}:${depth}`, () => 
                apiFetch<{ results: NotionBlock[] }>(activeToken.token, `/api/notion/page/${node.id}/content?depth=${depth}`, { signal: controller.signal, onStatus: setExportStatus })
              );
              blocks = body.results;

              // If blocks contain child_database, fetch their content too for proper nesting
              for (const block of blocks as any[]) {
                if (block.type === "child_database") {
                  const dbMetadata = await apiFetch<{ dataSourceId: string; columns?: string[]; properties?: Record<string, any>; columnDetails?: any[] }>(activeToken.token, `/api/notion/database/${block.id}?kind=database`, { signal: controller.signal, onStatus: setExportStatus });
                  const dbRowKind = resolveRowSourceKind(block.id, dbMetadata.dataSourceId, "database");
                  
                  // Filter nested database rows based on whether their tree node row IDs are selected
                  const dbTreeNode = flatNodes.find(n => n.id === block.id);
                  const dbRows = await memoFetch(rowsCache.current, `${activeToken.token}:rows:${dbMetadata.dataSourceId}:${dbRowKind}:${dbTreeNode?.viewId ?? ""}`, () => fetchAllRows(activeToken.token, dbMetadata.dataSourceId, dbRowKind, dbTreeNode?.viewId, undefined, { signal: controller.signal, onStatus: setExportStatus }));
                  let exportDbRows: NotionPage[] = [];
                  if (dbTreeNode && dbTreeNode.children && dbTreeNode.children.length > 0) {
                    const selectedRowIds = new Set(dbTreeNode.children.filter(c => selected.has(c.id)).map(c => c.id));
                    exportDbRows = dbRows.filter(row => selectedRowIds.has(row.id));
                  }

                  items.push({
                    kind: "database",
                    id: block.id,
                    title: block.child_database?.title ?? "Untitled database",
                    rows: exportDbRows,
                    columns: dbMetadata.columns,
                    columnDetails: dbMetadata.columnDetails ?? dbTreeNode?.columnDetails,
                    viewId: dbTreeNode?.viewId,
                    viewTitle: dbTreeNode?.views?.find((view) => view.id === dbTreeNode.viewId)?.title,
                    properties: dbMetadata.properties,
                    depth: (node.depth ?? 0) + 2
                  });
                }
              }

              // Filter blocks based on selection if blocks are shown in tree
              if (node.children && node.children.length > 0) {
                const selectedInTree = new Set(node.children.filter(c => selected.has(c.id)).map(c => c.id));
                // Only filter if some children are NOT selected (to avoid unexpected empty export if nothing selected in sub-tree)
                if (selectedInTree.size < node.children.length) {
                  blocks = blocks.filter(b => selectedInTree.has(b.id));
                }
              }
            } catch {
              blocks = [];
            }
          }
          
          const rowAlreadyInSelectedTable = node.kind === "row" && node.parentId && selected.has(node.parentId);
          // Only skip a row if: it is already rendered as a table row by the parent database
          // AND it has no block content AND the user hasn't explicitly selected any child blocks inside it.
          const hasSelectedChildren = node.children?.some(c => selected.has(c.id)) ?? false;
          if (rowAlreadyInSelectedTable && !blocks.length && !hasSelectedChildren) {
             // Skip — pure leaf row, rendered only in the parent table
          } else {
             items.push({ kind: node.kind, title: node.title, page: node.page, blocks, includeProperties: !rowAlreadyInSelectedTable, depth: node.depth + 1 });
          }
        }
        
        baseProgress += UNITS_PER_NODE;
        setExportCurrent(baseProgress);
      }
      
      setExportStatus("Generating export mapping...");
      const titleById = await buildExportTitleMap(activeToken.token, items, flatNodes, titleCache.current, { signal: controller.signal, onStatus: setExportStatus });
      
      setExportStatus("Ready!");
      setTitleMap(titleById);
      setExportItems(items);
      
      // Ensure we hit the 100% mark in state before closing
      setExportCurrent(selectedNodes.length * UNITS_PER_NODE);
      
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
    } finally {
      // Keep open just long enough for the satisfaction animation to complete
      const delay = controller.signal.aborted ? 0 : 800;
      setTimeout(() => setExporting(false), delay);
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  }

  function cancelExport() {
    exportAbortRef.current?.abort();
    setExportStatus("Cancelled.");
    setExporting(false);
  }

  function cancelFetch() {
    treeAbortRef.current?.abort();
    setLoadingTree(false);
  }

  function clearWork() {
    treeAbortRef.current?.abort();
    exportAbortRef.current?.abort();
    setUrl("");
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    setExportItems([]);
    setError("");
    setLoadingTree(false);
    setExporting(false);
  }

  return (
    <main className="min-h-screen pb-24 bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="cursor-pointer select-none flex items-center gap-2.5" onClick={clearWork} title="Start over">
            <Image src="/favicon.png" alt="Notionpull logo" width={28} height={28} className="rounded-md" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Notionpull</h1>
              <p className="text-xs font-medium text-zinc-500">
                {activeToken?.workspaceName 
                  ? `${activeToken.workspaceName} (${activeToken.label})` 
                  : activeToken?.label ?? "No active workspace"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 transition" onClick={() => setDebugOpen(true)}>
              Debug
            </button>
            <button className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 transition" onClick={() => setManagerOpen(true)}>
              Tokens
            </button>
          </div>
        </div>
      </header>

      <div className="w-full px-6 py-8">
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
                <label className="block text-sm font-medium text-zinc-900">Paste a Notion page or database URL</label>
                
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Depth</span>
                    <div className="flex rounded-md border border-zinc-300 bg-zinc-50 p-0.5 shadow-sm">
                      {depthOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`rounded px-2.5 py-0.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-50 ${depth === option ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:bg-zinc-100"}`}
                          onClick={() => {
                            if (option !== depth) {
                              if (detected) {
                                setLoadingTree(true);
                              }
                              setDepth(option);
                            }
                          }}
                          disabled={loadingTree}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="hidden sm:block h-5 w-px bg-zinc-300" />

                  <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={showRelationIds}
                        onChange={(e) => handleShowRelationIdsChange(e.target.checked)}
                      />
                      <div className={`w-9 h-5 rounded-full transition-colors duration-200 ease-in-out ${showRelationIds ? "bg-zinc-900" : "bg-zinc-200"}`} />
                      <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ease-in-out ${showRelationIds ? "translate-x-4" : "translate-x-0"}`} />
                    </div>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-600 transition-colors">Relation IDs</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <input
                    className="w-full rounded-md border border-zinc-300 pl-3.5 pr-10 py-2 text-sm outline-none transition focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://www.notion.so/..."
                  />
                  {url && (
                    <button
                      type="button"
                      onClick={clearWork}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="Clear"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <button 
                  className="flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 disabled:bg-zinc-400 min-w-[100px]" 
                  disabled={loadingTree || !url.trim()}
                >
                  {loadingTree && !detected ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    "Fetch"
                  )}
                </button>
                {loadingTree && (
                  <button
                    type="button"
                    onClick={cancelFetch}
                    className="flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </button>
                )}
              </div>
              
              {urlHistory.length > 0 && !detected && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <History className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs text-zinc-500">Recent:</span>
                  {urlHistory.map((item, i) => (
                    <div key={i} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => setUrl(item.url)}
                        className="flex items-center gap-1.5 rounded-l border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
                        title={item.url}
                      >
                        <span className="font-bold text-zinc-400 uppercase text-[10px]">
                          {item.type === 'page' ? 'P' : item.type === 'database' || item.type === 'data_source' ? 'D' : '?'}
                        </span>
                        <span className="max-w-[150px] truncate">{item.title || item.url}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUrlHistory(i)}
                        className="flex items-center justify-center rounded-r border-y border-r border-zinc-200 bg-white px-1.5 py-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                        title="Remove from history"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
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
                  <button 
                    onClick={handleRefresh}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50"
                    title="Refresh (Clear Cache)"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingTree ? 'animate-spin text-zinc-900' : ''}`} />
                  </button>
                  {relativeTime && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                      Fetched {relativeTime}
                    </span>
                  )}
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
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/90 backdrop-blur-md px-6 py-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="w-full flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-700">
              <span className="inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-zinc-900 mr-1.5">{selected.size}</span>
              items selected
            </div>
            <button 
              className="flex items-center gap-2 rounded-md bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-zinc-800 active:scale-95 hover:shadow-lg disabled:bg-zinc-400" 
              onClick={runExport} 
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>Preparing...</span>
                </>
              ) : (
                "Export"
              )}
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
        showIdForRelationRollup={showRelationIds}
      />

      <ExportProgress 
        open={exporting} 
        total={exportTotal} 
        current={exportCurrent} 
        status={exportStatus}
        onCancel={cancelExport}
      />

      <ExportModal 
        open={exportItems.length > 0 && !exporting} 
        items={exportItems} 
        titleById={titleMap} 
        onClose={() => setExportItems([])} 
        showIdForRelationRollup={showRelationIds}
        onToggleShowIdForRelationRollup={handleShowRelationIdsChange}
      />

      <DebugModal open={debugOpen} onClose={() => setDebugOpen(false)} />
    </main>
  );
}

// Data Fetching logic (kept same except TreeNodeData modifications)

function treeCacheKey(id: string, depth: DepthOption, viewId?: string): string {
  return `${id}-${viewId ?? "default"}-${depth}`;
}

function depthValue(depth: DepthOption): number {
  return depth === "All" ? Infinity : Number(depth);
}

function getCachedTreeForDepth(cache: Map<string, TreeNodeData>, rootId: string, depth: DepthOption, viewId?: string): TreeNodeData | null {
  const exact = cache.get(treeCacheKey(rootId, depth, viewId));
  if (exact) return exact;

  const requestedDepth = depthValue(depth);
  for (const option of depthOptions) {
    if (depthValue(option) <= requestedDepth) continue;

    const deeperTree = cache.get(treeCacheKey(rootId, option, viewId));
    if (deeperTree) return cloneTreeToDepth(deeperTree, requestedDepth);
  }

  return null;
}

function cloneTreeToDepth(node: TreeNodeData, maxDepth: number): TreeNodeData {
  if (node.depth >= maxDepth || !node.children?.length) {
    return { ...node, children: undefined };
  }

  return {
    ...node,
    children: node.children.map((child) => cloneTreeToDepth(child, maxDepth))
  };
}

type PageChildrenResponse = { results: Array<{ id: string; type: "page" | "database" | "block"; title: string; dataSourceName?: string }> };
type DatabaseResponse = { dataSourceId: string; dataSourceName?: string; title: string; viewId?: string; views?: Array<{ id: string; title?: string }>; columnDetails?: Array<{ id?: string; name: string; visible?: boolean; width?: number }>; columns?: string[]; selectedColumns?: string[]; properties?: Record<string, any> };
type BuildMemo = {
  pageChildren: Map<string, Promise<PageChildrenResponse>>;
  databases: Map<string, Promise<DatabaseResponse>>;
  rows: Map<string, Promise<NotionPage[]>>;
  showIdForRelationRollup?: boolean;
  signal?: AbortSignal;
};

async function buildNode(token: string, node: TreeNodeData, maxDepth: number, memo: BuildMemo): Promise<TreeNodeData> {
  try {
    if (node.kind === "page" || node.kind === "row" || node.kind === "block") {
      if (node.depth >= maxDepth) return node;
      if (!node.children) {
        const body = await memoPageChildren(token, node.id, memo);
        node.children = body.results.map((child: any) => ({
          id: child.id,
          title: child.title,
          kind: child.type as any,
          depth: node.depth + 1,
          parentId: node.id,
          dataSourceName: child.dataSourceName
        }));

        if (node.kind === "row" && node.page?.properties) {
          const allIds = extractNotionIds(JSON.stringify(node.page.properties));
          const uniqueIds = Array.from(new Set(allIds)).filter(id => id !== node.id && id !== node.parentId);
          if (uniqueIds.length > 0) {
            for (const id of uniqueIds) {
              try {
                const dp = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(id)}`, { signal: memo.signal });
                if (dp.type === "database" || dp.type === "page" || dp.type === "data_source") {
                  if (!node.children.some(c => c.id === dp.id)) {
                    node.children.push({
                      id: dp.id,
                      title: dp.title,
                      kind: dp.type as any,
                      depth: node.depth + 1,
                      parentId: node.id,
                      dataSourceName: dp.dataSourceName
                    });
                  }
                }
              } catch (err) {
                if (isAbortError(err)) throw err;
              }
            }
          }
        }
      }
      node.children = await Promise.all(node.children.map((child) => buildNode(token, child, maxDepth, memo)));
    }
    if (node.kind === "database" || node.kind === "data_source") {
      const metadata = await resolveContainerMetadata(token, node, memo);
      node.kind = metadata.kind;
      node.viewId = node.viewId ?? metadata.viewId;
      node.dataSourceId = metadata.dataSourceId;
      node.dataSourceName = metadata.dataSourceName ?? node.dataSourceName;
      node.columns = metadata.columns ?? node.columns;
      node.selectedColumns = metadata.selectedColumns ?? node.selectedColumns;
      node.columnDetails = metadata.columnDetails ?? node.columnDetails;
      node.properties = metadata.properties ?? node.properties;
      const rowSourceKind = resolveRowSourceKind(node.id, node.dataSourceId, node.kind as "database" | "data_source");
      
      if (node.depth + 1 > maxDepth) return node;
      
      if (!node.children) {
        const rows = await rowNodes(token, node.dataSourceId ?? node.id, rowSourceKind, node.viewId, node.depth + 1, node.id, memo, node.previewColumns);
        node.children = rows;
      }
      
      node.children = await Promise.all((node.children ?? []).map((row) => buildNode(token, row, maxDepth, memo)));
    }
  } catch (err) {
    node.error = errorMessage(err);
  }
  return node;
}

async function rowNodes(token: string, dataSourceId: string, kind: "database" | "data_source", viewId: string | undefined, depth: number, parentId: string, memo: BuildMemo, previewColumns?: string[]): Promise<TreeNodeData[]> {
  const rows = await memoRows(token, dataSourceId, kind, viewId, memo);
  return rows.map((row) => {
    let title = "";
    if (previewColumns && previewColumns.length > 0) {
      title = previewColumns
        .map(col => propertyValue(row.properties?.[col], { showIdForRelationRollup: memo.showIdForRelationRollup }))
        .filter(Boolean)
        .join(" · ");
    } else {
      title = firstTitleProperty(row);
    }
    return {
      id: row.id,
      title: title || "Untitled",
      kind: "row",
      depth,
      parentId,
      page: row
    };
  });
}

async function resolveContainerMetadata(token: string, node: TreeNodeData, memo: BuildMemo): Promise<Pick<TreeNodeData, "kind" | "dataSourceId" | "dataSourceName" | "columns" | "properties" | "views" | "viewId" | "selectedColumns" | "columnDetails">> {
  if (node.dataSourceId && node.columns && node.properties) {
    return {
      kind: node.kind === "data_source" ? "data_source" : "database",
      dataSourceId: node.dataSourceId,
      dataSourceName: node.dataSourceName,
      columns: node.columns,
      views: node.views,
      columnDetails: node.columnDetails,
      properties: node.properties,
      viewId: node.viewId,
      selectedColumns: node.selectedColumns
    };
  }

  try {
    const metadata = await memoDatabase(token, node.id, node.kind === "data_source" ? "data_source" : "database", node.viewId, memo);
    return {
      kind: node.kind === "data_source" ? "data_source" : "database",
      dataSourceId: metadata.dataSourceId,
      dataSourceName: metadata.dataSourceName ?? node.dataSourceName,
      columns: metadata.columns,
      selectedColumns: metadata.selectedColumns,
      views: metadata.views ?? node.views,
      columnDetails: metadata.columnDetails ?? node.columnDetails,
      properties: metadata.properties,
      viewId: metadata.viewId,
    };
  } catch {
    const viewQuery = node.viewId ? `&viewId=${encodeURIComponent(node.viewId)}` : "";
    const detected = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(node.id)}${viewQuery}`, { signal: memo.signal });
    return {
      kind: detected.type === "data_source" ? "data_source" : "database",
      dataSourceId: detected.dataSourceId ?? node.id,
      dataSourceName: detected.dataSourceName ?? node.dataSourceName,
      columns: detected.columns ?? node.columns,
      selectedColumns: detected.selectedColumns ?? node.selectedColumns,
      views: detected.views ?? node.views,
      columnDetails: detected.columnDetails ?? node.columnDetails,
      properties: detected.properties ?? node.properties,
      viewId: detected.viewId ?? node.viewId,
    };
  }
}

function memoPageChildren(token: string, pageId: string, memo: BuildMemo): Promise<PageChildrenResponse> {
  return memoFetch(memo.pageChildren, `${token}:page:${pageId}`, () => (
    apiFetch<PageChildrenResponse>(token, `/api/notion/page/${pageId}/children`, { signal: memo.signal })
  ));
}

function memoDatabase(token: string, databaseId: string, kind: "database" | "data_source", viewId: string | undefined, memo: BuildMemo): Promise<DatabaseResponse> {
  const viewQuery = viewId ? `&viewId=${encodeURIComponent(viewId)}` : "";
  return memoFetch(memo.databases, `${token}:database:${databaseId}:${kind}:${viewId ?? ""}`, () => (
    apiFetch<DatabaseResponse>(token, `/api/notion/database/${databaseId}?kind=${encodeURIComponent(kind)}${viewQuery}`, { signal: memo.signal })
  ));
}

function memoRows(token: string, dataSourceId: string, kind: "database" | "data_source", viewId: string | undefined, memo: BuildMemo): Promise<NotionPage[]> {
  return memoFetch(memo.rows, `${token}:rows:${dataSourceId}:${kind}:${viewId ?? ""}`, () => fetchAllRows(token, dataSourceId, kind, viewId, undefined, { signal: memo.signal }));
}

function memoFetch<T>(cache: Map<string, Promise<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;

  const request = fetcher().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, request);
  return request;
}

function resolveRowSourceKind(containerId: string, dataSourceId: string | undefined, kind: "database" | "data_source"): "database" | "data_source" {
  if (dataSourceId && dataSourceId !== containerId) return "data_source";
  return kind === "data_source" ? "data_source" : "database";
}

type ApiFetchOptions = {
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
};

let notionClientQueue: Promise<void> = Promise.resolve();
let notionClientBlockedUntil = 0;
const NOTION_MIN_REQUEST_SPACING_MS = 375;

async function fetchAllRows(token: string, dataSourceId: string, kind: "database" | "data_source", viewId?: string, onProgress?: (count: number) => void, options: ApiFetchOptions = {}): Promise<NotionPage[]> {
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ kind });
    if (cursor) qs.set("cursor", cursor);
    if (viewId) qs.set("viewId", viewId);
    const body = await apiFetch<RowsResponse>(token, `/api/notion/datasource/${dataSourceId}/rows?${qs.toString()}`, options);
    rows.push(...body.results);
    cursor = body.has_more ? body.next_cursor : null;
    if (onProgress) onProgress(rows.length);
  } while (cursor);
  return rows;
}

async function apiFetch<T>(token: string, url: string, options: ApiFetchOptions = {}, attempt = 0): Promise<T> {
  await waitForNotionTurn(options);
  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-notion-token": token }, signal: options.signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error("Could not reach Notion — check your connection");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt < 5) {
    const retryMs = retryAfterMs(response.headers.get("retry-after"), attempt);
    notionClientBlockedUntil = Math.max(notionClientBlockedUntil, Date.now() + retryMs);
    options.onStatus?.(`Notion rate limit hit. Pausing ${formatWait(retryMs)} before retry ${attempt + 1}/5.`);
    await sleep(retryMs, options.signal);
    return apiFetch<T>(token, url, options, attempt + 1);
  }
  if (!response.ok) throw new Error(mapHttpError(response.status, body.error));
  return body as T;
}

async function waitForNotionTurn(options: ApiFetchOptions) {
  const previous = notionClientQueue;
  let release!: () => void;
  notionClientQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(NOTION_MIN_REQUEST_SPACING_MS, notionClientBlockedUntil - Date.now());
    if (waitMs > 0) {
      if (waitMs > NOTION_MIN_REQUEST_SPACING_MS) {
        options.onStatus?.(`Notion is cooling down. Next request in ${formatWait(waitMs)}.`);
      }
      await sleep(waitMs, options.signal);
    }
  } finally {
    release();
  }
}

function retryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.max(1000, dateMs - Date.now());
  }
  return Math.min(30000, 2000 * 2 ** attempt);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(abortError());
    }, { once: true });
  });
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

function abortError() {
  return new DOMException("Cancelled", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function mapHttpError(status: number, detail?: string): string {
  if (status === 401) return "Token invalid or expired — check your Notion token";
  if (status === 404) return "Not found — make sure the integration has access to this page (Share → Invite integration)";
  if (status === 429) return "Notion rate limit is still active. Try again after the current cooldown finishes.";
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

async function buildExportTitleMap(token: string, items: ExportItem[], nodes: TreeNodeData[], cache: Map<string, string>, options: ApiFetchOptions = {}): Promise<Map<string, string>> {
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
  let resolved = 0;
  for (const id of missingIds) {
    try {
      options.onStatus?.(`Resolving linked titles ${resolved + 1}/${missingIds.length}...`);
      const object = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(id)}`, options);
      titleById.set(id, object.title);
      cache.set(id, object.title);
    } catch (err) {
      if (isAbortError(err)) throw err;
      titleById.set(id, "");
    }
    resolved += 1;
  }
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
      if (!relation.id) continue;
      if (relation.title) {
        titleById.set(relation.id, relation.title);
      } else if (!titleById.has(relation.id)) {
        titleById.set(relation.id, "");
      }
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
