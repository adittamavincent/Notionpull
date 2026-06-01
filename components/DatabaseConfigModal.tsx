"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { X, Eye } from "lucide-react";
import type { TreeNodeData, NotionPage } from "@/types/notion";
import { propertyValue, getDefaultTitleColumn } from "@/lib/notion";

type Props = {
  open: boolean;
  token?: string;
  node: TreeNodeData | null;
  onClose: () => void;
  onSave: (nodeId: string, selectedColumns: string[], previewColumns?: string[]) => void;
};

export function DatabaseConfigModal({ open, token, node, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetchedRows, setFetchedRows] = useState<NotionPage[]>([]);
  const [titleById, setTitleById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);
  const [previewColumns, setPreviewColumns] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; col: string } | null>(null);

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);

  // Extract columns and rows from the node's children or fetchedRows
  const nodeRows = useMemo(() => 
    (node?.children ?? []).map(child => child.page).filter(Boolean) as NotionPage[],
    [node?.children]
  );
  
  const rows = useMemo(
    () => nodeRows.length > 0 ? nodeRows : fetchedRows,
    [nodeRows, fetchedRows]
  );
  
  const allColumns = useMemo(
    () => Array.from(new Set([...(node?.columns ?? []), ...rows.flatMap(row => Object.keys(row.properties ?? {}))])),
    [node?.columns, rows]
  );

  const titleSeed = useMemo(() => {
    const nextTitleById = new Map<string, string>();
    for (const row of rows) {
      if (row.id) {
        const title = propertyValue(Object.values(row.properties ?? {}).find((prop: any) => prop?.type === "title"));
        if (title) nextTitleById.set(row.id, title);
      }
      collectRelationIds(row.properties, nextTitleById);
    }

    return {
      titleById: nextTitleById,
      missingIds: Array.from(nextTitleById.entries()).filter(([, title]) => !title).map(([id]) => id)
    };
  }, [rows]);

  const propertyValueOptions = useMemo(() => ({ titleById }), [titleById]);

  const defaultTitleCol = useMemo(() => {
    // 1. Try from rows properties
    if (rows.length > 0 && rows[0].properties) {
      return getDefaultTitleColumn(rows[0].properties);
    }
    // 2. Try from database schema properties
    if (node?.properties) {
      return getDefaultTitleColumn(node.properties);
    }
    return "title";
  }, [node, rows]);

  useEffect(() => {
    if (open && node) {
      if (node.previewColumns && node.previewColumns.length > 0) {
        setPreviewColumns(new Set(node.previewColumns));
      } else if (node.previewColumn) {
        setPreviewColumns(new Set([node.previewColumn]));
      } else {
        setPreviewColumns(new Set([defaultTitleCol]));
      }
    }
  }, [open, node, defaultTitleCol]);

  useEffect(() => {
    if (!open || !node) return;
    
    // Fetch rows when they are not preloaded on the node.
    if (nodeRows.length === 0 && fetchedRows.length === 0 && token) {
      setLoading(true);
      const dataSourceId = node.dataSourceId ?? node.id;
      const kind = dataSourceId !== node.id ? "data_source" : (node.kind === "data_source" ? "data_source" : "database");
      fetch(`/api/notion/datasource/${dataSourceId}/rows?kind=${encodeURIComponent(kind)}`, {
        headers: { "x-notion-token": token }
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.results) {
            setFetchedRows(data.results);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [open, node, token, nodeRows.length, fetchedRows.length]);

  useEffect(() => {
    if (!open || !token || rows.length === 0) return;

    if (!titleSeed.missingIds.length) {
      setTitleById(titleSeed.titleById);
      return;
    }

    const nextTitleById = new Map(titleSeed.titleById);
    let cancelled = false;
    Promise.all(titleSeed.missingIds.map(async (id) => {
      try {
        const res = await fetch(`/api/notion/detect?id=${encodeURIComponent(id)}`, {
          headers: { "x-notion-token": token }
        });
        if (!res.ok) throw new Error("Title fetch failed");
        const data = await res.json();
        nextTitleById.set(id, data.title ?? "");
      } catch {
        nextTitleById.set(id, "");
      }
    })).then(() => {
      if (!cancelled) setTitleById(new Map(nextTitleById));
    });

    return () => {
      cancelled = true;
    };
  }, [open, token, rows.length, titleSeed]);

  useEffect(() => {
    if (open && node && !hasInitializedSelection) {
      if (node.selectedColumns && node.selectedColumns.length > 0) {
        setSelected(new Set(node.selectedColumns));
        setHasInitializedSelection(true);
      } else if (allColumns.length > 0) {
        setSelected(new Set(allColumns));
        setHasInitializedSelection(true);
      }
    }
  }, [open, node, allColumns, hasInitializedSelection]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setFetchedRows([]);
      setTitleById(new Map());
      setHasInitializedSelection(false);
      setPreviewColumns(new Set());
      setContextMenu(null);
    }
  }, [open]);

  const toggleColumn = useCallback((col: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!node) return;
    const orderedSelected = allColumns.filter(col => selected.has(col));
    const orderedPreviews = allColumns.filter(col => previewColumns.has(col));
    onSave(node.id, orderedSelected, orderedPreviews);
    onClose();
  }, [node, onClose, onSave, selected, allColumns, previewColumns]);

  const visibleColumns = useMemo(
    () => allColumns.filter(col => selected.has(col)),
    [allColumns, selected]
  );

  const orderedColumnDetails = useMemo(() => node?.columnDetails ?? [], [node?.columnDetails]);

  const activeView = useMemo(() => {
    if (!node?.viewId) return null;
    return node.views?.find((view) => view.id === node.viewId) ?? { id: node.viewId, title: undefined };
  }, [node?.viewId, node?.views]);

  const columnSchemaDetails = useMemo(() => {
    const details = new Map<string, { index: number; width?: number; visible?: boolean }>();
    
    // First map all columns in orderedColumnDetails
    orderedColumnDetails.forEach((col, idx) => {
      details.set(col.name, { index: idx + 1, width: col.width, visible: col.visible });
    });
    
    // For any columns that are in allColumns but not in orderedColumnDetails, append them at the end
    let nextIndex = orderedColumnDetails.length + 1;
    allColumns.forEach((col) => {
      if (!details.has(col)) {
        details.set(col, { index: nextIndex++, visible: true });
      }
    });
    
    return details;
  }, [orderedColumnDetails, allColumns]);

  if (!open || !node) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-5 backdrop-blur-sm">
      <div className="flex max-h-[95vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        
        {/* Compact Dialogue Header with Views, Counts, and Actions */}
        <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4 bg-zinc-50/50 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <h2 className="text-base font-bold text-zinc-900 leading-tight">Configure Database</h2>
              <span className="text-xs font-semibold text-zinc-500 truncate max-w-[200px]">{node.title}</span>
              <span className="rounded-full bg-zinc-200/80 px-2.5 py-0.5 text-[10px] font-bold text-zinc-600 shadow-sm border border-zinc-300/35">
                {visibleColumns.length} of {allColumns.length} columns selected
              </span>
            </div>
            
            <p className="mt-1 text-[11px] leading-snug text-zinc-400 font-medium max-w-[700px]">
              Left-click table headers to toggle inclusion in exports. Right-click any header to toggle it in the navigation tree preview.
            </p>

            {node.views?.length ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-400 mr-1">Views:</span>
                {node.views.map((view) => (
                  <span
                    key={view.id}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${view.id === node.viewId ? "border-zinc-900 bg-zinc-900 text-white shadow-sm" : "border-zinc-200 bg-white text-zinc-500"}`}
                    title={view.id}
                  >
                    {view.title || view.id}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2">
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {activeView ? `View: ${activeView.title || activeView.id}` : "View: default schema"}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 transition shrink-0 ml-4">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* dialogue Body containing only the unified preview table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-6">
          <div className="flex-1 overflow-auto rounded-lg border border-zinc-200">
            <table className="w-full text-left text-sm text-zinc-600">
              <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  {allColumns.map(col => {
                    const schema = columnSchemaDetails.get(col);
                    const isIncluded = selected.has(col);
                    const isPreviewing = previewColumns.has(col);
                    const widthStr = schema?.width ? `${schema.width}px` : "";
                    const indexStr = schema?.index ? `${schema.index}` : "";
                    
                    return (
                      <th key={col} className="p-0 font-medium align-middle">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleColumn(col);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ x: e.clientX, y: e.clientY, col });
                          }}
                          aria-pressed={isIncluded}
                          className="flex w-full items-center px-4 py-3 transition-colors hover:bg-zinc-100 font-sans cursor-context-menu select-none border-r border-zinc-200/60 last:border-r-0"
                        >
                          <div className="flex flex-col items-start gap-1 min-w-0 w-full text-left">
                            {/* Top row: Index and width details */}
                            <div className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wider text-zinc-400">
                              <span className="bg-zinc-200/70 border border-zinc-300/35 px-1 py-0.25 rounded text-zinc-500 shrink-0">
                                #{indexStr}
                              </span>
                              {widthStr && (
                                <span className="shrink-0">{widthStr}</span>
                              )}
                            </div>
                            
                            {/* Middle row: Inclusion Toggle bullet & Column Name */}
                            <div className="flex items-center gap-1.5 min-w-0 w-full">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isIncluded ? "bg-emerald-500 animate-pulse" : "bg-zinc-300"}`} />
                              <span className={`font-bold text-[12px] truncate ${isIncluded ? "text-zinc-800" : "text-zinc-400"}`}>
                                {col}
                              </span>
                            </div>
                            
                            {/* Bottom row: Tree preview indicator badge */}
                            {isPreviewing && (
                              <span className={`inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.25 text-[8px] font-black uppercase tracking-wider text-blue-600 shadow-sm shrink-0 ${
                                isIncluded ? "bg-zinc-800 text-zinc-100 border-zinc-700" : ""
                              }`}>
                                <Eye className="h-2 w-2" />
                                Previewing
                              </span>
                            )}
                          </div>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50">
                    {allColumns.map(col => (
                      <td key={col} className="max-w-0 truncate px-4 py-3">
                        <span className={selected.has(col) ? "text-zinc-700" : "text-zinc-400"}>
                          {propertyValue(row.properties?.[col], propertyValueOptions)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={Math.max(allColumns.length, 1)} className="px-4 py-8 text-center text-zinc-500">
                      No rows to preview.
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={Math.max(allColumns.length, 1)} className="px-4 py-8 text-center text-zinc-500 animate-pulse">
                      Loading preview data...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            Cancel
          </button>
          <button onClick={handleSave} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Save Configuration
          </button>
        </div>
      </div>

      {contextMenu && (
        <div 
          className="fixed z-[100] rounded-xl border border-zinc-200 bg-white py-1.5 shadow-2xl text-xs font-bold text-zinc-700 min-w-[200px] animate-in fade-in duration-100"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {previewColumns.has(contextMenu.col) ? (
            <button
              type="button"
              onClick={() => {
                setPreviewColumns(prev => {
                  const next = new Set(prev);
                  next.delete(contextMenu.col);
                  // Ensure we don't end up with 0 preview columns (fallback to default)
                  if (next.size === 0) {
                    next.add(defaultTitleCol);
                  }
                  return next;
                });
                setContextMenu(null);
              }}
              className="flex w-full items-center px-4.5 py-2.5 hover:bg-red-50 text-red-600 transition-colors text-left"
            >
              <Eye className="h-3.5 w-3.5 mr-2" />
              <span>Remove from Tree Preview</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPreviewColumns(prev => {
                  const next = new Set(prev);
                  next.add(contextMenu.col);
                  return next;
                });
                setContextMenu(null);
              }}
              className="flex w-full items-center px-4.5 py-2.5 hover:bg-zinc-50 text-zinc-800 transition-colors text-left"
            >
              <Eye className="h-3.5 w-3.5 mr-2" />
              <span>Add to Tree Preview</span>
            </button>
          )}
          
          <button
            type="button"
            onClick={() => {
              setPreviewColumns(new Set([defaultTitleCol]));
              setContextMenu(null);
            }}
            className="flex w-full items-center px-4.5 py-2.5 hover:bg-zinc-50 text-zinc-500 border-t border-zinc-100 transition-colors text-left font-medium"
          >
            <span>Reset to Default Title</span>
          </button>
        </div>
      )}
    </div>
  );
}

function collectRelationIds(properties: Record<string, any> | undefined, titleById: Map<string, string>) {
  for (const prop of Object.values(properties ?? {})) collectRelationIdsFromValue(prop, titleById);
}

function collectRelationIdsFromValue(value: any, titleById: Map<string, string>) {
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
  if (value.type === "rollup" && value.rollup?.type === "array") {
    for (const item of value.rollup.array ?? []) collectRelationIdsFromValue(item, titleById);
  }
}
