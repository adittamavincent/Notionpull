"use client";

import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import type { TreeNodeData, NotionPage } from "@/types/notion";
import { propertyValue } from "@/lib/notion";

type Props = {
  open: boolean;
  token?: string;
  node: TreeNodeData | null;
  onClose: () => void;
  onSave: (nodeId: string, selectedColumns: string[]) => void;
};

export function DatabaseConfigModal({ open, token, node, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetchedRows, setFetchedRows] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  // Extract columns and rows from the node's children or fetchedRows
  const nodeRows = useMemo(() => 
    (node?.children ?? []).map(child => child.page).filter(Boolean) as NotionPage[],
    [node?.children]
  );
  
  const rows = nodeRows.length > 0 ? nodeRows : fetchedRows;
  
  const allColumns = useMemo(
    () => Array.from(new Set([...(node?.columns ?? []), ...rows.flatMap(row => Object.keys(row.properties ?? {}))])),
    [node?.columns, rows]
  );

  useEffect(() => {
    if (!open || !node) return;
    
    // Fetch rows when they are not preloaded on the node.
    if (nodeRows.length === 0 && fetchedRows.length === 0 && token) {
      setLoading(true);
      const dataSourceId = node.dataSourceId ?? node.id;
      fetch(`/api/notion/datasource/${dataSourceId}/rows`, {
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
      setHasInitializedSelection(false);
    }
  }, [open]);

  if (!open || !node) return null;

  const toggleColumn = (col: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const handleSave = () => {
    onSave(node.id, Array.from(selected));
    onClose();
  };

  const visibleColumns = allColumns.filter(col => selected.has(col));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-5 backdrop-blur-sm">
      <div className="flex max-h-[95vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Configure Database</h2>
            <p className="text-sm text-zinc-500">{node.title}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-900">Data Preview</h3>
            <p className="text-xs text-zinc-500">
              {visibleColumns.length} of {allColumns.length} columns selected
            </p>
          </div>
            
            <div className="flex-1 overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full text-left text-sm text-zinc-600">
                <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    {allColumns.map(col => (
                      <th key={col} className="p-0 font-medium align-middle">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleColumn(col);
                          }}
                          aria-pressed={selected.has(col)}
                          className="flex w-full items-center px-4 py-3 transition-colors hover:bg-zinc-100"
                        >
                          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-normal transition-colors whitespace-nowrap shadow-sm ${
                            selected.has(col)
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-300 bg-white text-zinc-600"
                          }`}>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                selected.has(col) ? "bg-white" : "bg-zinc-400"
                              }`}
                            />
                            <span>{col}</span>
                          </div>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  {rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50">
                      {allColumns.map(col => (
                        <td key={col} className="max-w-0 truncate px-4 py-3">
                          <span className={selected.has(col) ? "text-zinc-700" : "text-zinc-400"}>
                            {propertyValue(row.properties?.[col])}
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
    </div>
  );
}
