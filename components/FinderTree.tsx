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

function getSelectionState(node: TreeNodeData, selected: Set<string>): "checked" | "indeterminate" | "unchecked" {
  const descendants = flattenTree(node.children ?? []);

  if (!descendants.length) {
    return selected.has(node.id) ? "checked" : "unchecked";
  }

  const selectedCount = descendants.filter((descendant) => selected.has(descendant.id)).length;

  if (selectedCount === 0) {
    return selected.has(node.id) ? "checked" : "unchecked";
  }

  if (selectedCount === descendants.length) {
    return "checked";
  }

  return "indeterminate";
}

type RowProps = {
  node: TreeNodeData;
  selected: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onToggle: (node: TreeNodeData, checked: boolean) => void;
  onConfigureDatabase?: (node: TreeNodeData) => void;
  style?: React.CSSProperties;
};

function TreeRow({ node, selected, collapsed, onToggleCollapse, onToggle, onConfigureDatabase, style }: RowProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isDatabase = node.kind === "database" || node.kind === "data_source";
  const selectionState = getSelectionState(node, selected);
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
      className="group flex h-10 items-center gap-2 border-b border-zinc-100 pr-3 text-sm hover:bg-zinc-50"
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

      <span className="min-w-0 flex-1 truncate font-medium text-zinc-700">{node.title || "Untitled"}</span>

      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {node.kind.replace("_", " ")}
      </span>

      {isDatabase && onConfigureDatabase && (
        <button
          onClick={() => onConfigureDatabase(node)}
          className="hidden items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 shadow-sm transition hover:bg-zinc-50 group-hover:flex"
        >
          <Settings2 className="h-3 w-3" />
          Config
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // By default we might want to expand all nodes so it behaves like the old flat tree,
  // but a real Finder view lets you toggle. Let's auto-expand nodes that have children initially,
  // or just let them be expanded if they are in the 'expanded' set. To keep it simple, we'll
  // compute the visible flat list based on expanded state.
  // Actually, wait, depth options 1, 2, 3 "All" dictate how deep we fetched.
  // We can just show what we fetched, or let the user collapse.
  // Let's implement true collapsible nodes. By default, auto-expand everything that is fetched.

  const allParentIds = useMemo(() => {
    const parentIds = new Set<string>();
    const gather = (list: TreeNodeData[]) => {
      for (const node of list) {
        if (node.children?.length) {
          parentIds.add(node.id);
          gather(node.children);
        }
      }
    };
    gather(nodes);
    return parentIds;
  }, [nodes]);

  // Merge auto-expanded with manually collapsed (if we wanted to track collapsed instead).
  // For simplicity, we just use a `collapsed` set to track what user hides.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
            selected={selected}
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
              selected={selected}
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
