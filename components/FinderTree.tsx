"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, Database, Rows3, ChevronRight, ChevronDown, Settings2, AlertTriangle } from "lucide-react";
import type { TreeNodeData } from "@/types/notion";

type Props = {
  nodes: TreeNodeData[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (node: TreeNodeData, checked: boolean) => void;
  onConfigureDatabase?: (node: TreeNodeData) => void;
};

export function flattenTree(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

type SelectionState = "checked" | "indeterminate" | "unchecked";

type RowProps = {
  node: TreeNodeData;
  selectionState: SelectionState;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onToggle: (node: TreeNodeData, checked: boolean) => void;
  onConfigureDatabase?: (node: TreeNodeData) => void;
  style?: React.CSSProperties;
};

function TreeRow({ node, selectionState, collapsed, onToggleCollapse, onToggle, onConfigureDatabase, style }: RowProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isDatabase = node.kind === "database" || node.kind === "data_source";
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = selectionState === "indeterminate";
    }
  }, [selectionState]);

  const getIcon = (kind: string) => {
    switch (kind) {
      case "page": return <FileText className="h-4 w-4 text-zinc-500" />;
      case "database":
      case "data_source": return <Database className="h-4 w-4 text-blue-500" />;
      case "row": return <Rows3 className="h-4 w-4 text-emerald-500" />;
      default: return <FileText className="h-4 w-4 text-zinc-500" />;
    }
  };

  return (
    <div
      className="group relative flex h-10 items-center gap-2 border-b border-zinc-100 pr-3 text-sm hover:bg-zinc-50"
      style={{ ...style, paddingLeft: `${8 + node.depth * 24}px` }}
    >
      <button
        className={`flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200 ${hasChildren ? "text-zinc-500" : "invisible"}`}
        onClick={() => onToggleCollapse(node.id)}
      >
        {hasChildren && (isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
      </button>

      <input
        ref={checkboxRef}
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
        checked={selectionState === "checked"}
        onChange={(event) => onToggle(node, event.target.checked)}
        aria-label={`Select ${node.title}`}
        aria-checked={selectionState === "indeterminate" ? "mixed" : selectionState === "checked"}
      />

      <span className="flex items-center justify-center" aria-hidden>
        {getIcon(node.kind)}
      </span>

      <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
        <span className="truncate font-medium text-zinc-700 shrink-0">{node.title || "Untitled"}</span>
        {isDatabase && (
          <div 
            className="min-w-0 flex-1 flex items-center text-xs text-zinc-400 font-normal py-0.5 overflow-hidden whitespace-nowrap" 
            title={node.selectedColumns?.join(", ") || "All columns"}
          >
            {(() => {
              const selected = node.selectedColumns;
              const allCount = node.columns?.length || 0;
              if (!selected || (allCount > 0 && selected.length === allCount)) return <span>(all)</span>;
              if (selected.length === 0) return <span>(none)</span>;
              if (selected.length === 1) return <span className="truncate">({selected[0]})</span>;
              if (selected.length === 2) return <span className="truncate">({selected[0]}, {selected[1]})</span>;
              
              const first = selected[0];
              const last = selected[selected.length - 1];
              const middle = selected.slice(1, -1).join(", ");
              
              return (
                <div className="flex min-w-0 overflow-hidden">
                  <span className="shrink-0">({first},&nbsp;</span>
                  <span className="truncate">{middle}</span>
                  <span className="shrink-0">,&nbsp;{last})</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {node.kind.replace("_", " ")}
      </span>

      {isDatabase && onConfigureDatabase && (
        <button
          onClick={() => onConfigureDatabase(node)}
          className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 opacity-0 shadow-sm transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100"
          aria-label={`Configure ${node.title}`}
        >
          <Settings2 className="h-3 w-3" />
          Click to config
        </button>
      )}

      {node.error && (
        <span className="flex max-w-[200px] items-center gap-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700" title={node.error}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{node.error}</span>
        </span>
      )}
    </div>
  );
}

export function FinderTree({ nodes, selected, loading, onToggle, onConfigureDatabase }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const selectionStateById = useMemo(() => {
    const states = new Map<string, SelectionState>();

    const visit = (node: TreeNodeData): { total: number; selectedCount: number } => {
      let total = 0;
      let selectedCount = 0;

      for (const child of node.children ?? []) {
        total += 1;
        if (selected.has(child.id)) selectedCount += 1;

        const childResult = visit(child);
        total += childResult.total;
        selectedCount += childResult.selectedCount;
      }

      if (total === 0) {
        states.set(node.id, selected.has(node.id) ? "checked" : "unchecked");
      } else if (selectedCount === 0) {
        states.set(node.id, selected.has(node.id) ? "checked" : "unchecked");
      } else if (selectedCount === total) {
        states.set(node.id, "checked");
      } else {
        states.set(node.id, "indeterminate");
      }

      return { total, selectedCount };
    };

    for (const node of nodes) visit(node);
    return states;
  }, [nodes, selected]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleFlat = useMemo(() => {
    const list: TreeNodeData[] = [];
    const traverse = (nodeList: TreeNodeData[]) => {
      for (const node of nodeList) {
        list.push(node);
        if (node.children?.length && !collapsed.has(node.id)) {
          traverse(node.children);
        }
      }
    };
    traverse(nodes);
    return list;
  }, [nodes, collapsed]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleFlat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 15
  });

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="mb-2 h-10 animate-pulse rounded bg-zinc-100" />
        ))}
      </div>
    );
  }

  if (!nodes.length) {
    return <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">No content fetched.</div>;
  }

  if (visibleFlat.length <= 100) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        {visibleFlat.map((node) => (
          <TreeRow
            key={node.id}
            node={node}
            selectionState={selectionStateById.get(node.id) ?? "unchecked"}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onToggle={onToggle}
            onConfigureDatabase={onConfigureDatabase}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-[560px] overflow-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const node = visibleFlat[item.index];
          return (
            <TreeRow
              key={node.id}
              node={node}
              selectionState={selectionStateById.get(node.id) ?? "unchecked"}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              onToggle={onToggle}
              onConfigureDatabase={onConfigureDatabase}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
