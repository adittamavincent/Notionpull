"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Check } from "lucide-react";
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

  // Extract columns and rows from the node's children or fetchedRows
  const nodeRows = (node?.children ?? []).map(child => child.page).filter(Boolean) as NotionPage[];
  const rows = nodeRows.length > 0 ? nodeRows : fetchedRows;
  
  const allColumns = useMemo(
    () => Array.from(new Set([...(node?.columns ?? []), ...rows.flatMap(row => Object.keys(row.properties ?? {}))])),
    [node?.columns, rows]
  );
  const columnKey = allColumns.join(",");

  useEffect(() => {
    if (!open || !node) return;
    
    // If metadata has columns, config can open without loading rows.
    if (allColumns.length === 0 && nodeRows.length === 0 && fetchedRows.length === 0 && token) {
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
  }, [open, node, token, nodeRows.length, fetchedRows.length, allColumns.length]);

  useEffect(() => {
    if (open && node) {
      if (node.selectedColumns) {
        setSelected(new Set(node.selectedColumns));
      } else {
        setSelected(new Set(allColumns));
      }
    }
  }, [open, node, allColumns, columnKey]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setFetchedRows([]);
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

  const previewRows = rows.slice(0, 3); // Preview first 3 rows

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-5 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Configure Database</h2>
            <p className="text-sm text-zinc-500">{node.title}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          
          {/* Sidebar: Column Selection */}
          <div className="w-full overflow-y-auto border-r border-zinc-200 bg-zinc-50/50 p-6 lg:w-72">
            <h3 className="mb-4 text-sm font-medium text-zinc-900">Export Columns</h3>
            <div className="space-y-2">
              {allColumns.map(col => {
                const isSelected = selected.has(col);
                return (
                  <button
                    key={col}
                    onClick={() => toggleColumn(col)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    <span className="truncate">{col}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
              {allColumns.length === 0 && !loading && (
                <p className="text-sm text-zinc-500">No columns found.</p>
              )}
              {loading && (
                <p className="text-sm text-zinc-500 animate-pulse">Loading columns...</p>
              )}
            </div>
          </div>

          {/* Main: Live Preview */}
          <div className="flex flex-1 flex-col overflow-hidden bg-white p-6">
            <h3 className="mb-4 text-sm font-medium text-zinc-900">Data Preview</h3>
            
            <div className="flex-1 overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-max text-left text-sm text-zinc-600">
                <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    {allColumns.filter(col => selected.has(col)).map(col => (
                      <th key={col} className="px-4 py-3 font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  {previewRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50">
                      {allColumns.filter(col => selected.has(col)).map(col => (
                        <td key={col} className="max-w-[200px] truncate px-4 py-3">
                          {propertyValue(row.properties?.[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={Math.max(selected.size, 1)} className="px-4 py-8 text-center text-zinc-500">
                        No rows to preview.
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={Math.max(selected.size, 1)} className="px-4 py-8 text-center text-zinc-500 animate-pulse">
                        Loading preview data...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
