"use client";

import type { TreeNodeData } from "@/types/notion";

const iconByKind: Record<TreeNodeData["kind"], string> = {
  page: "📄",
  database: "🗃️",
  data_source: "🗃️",
  row: "⬜"
};

type Props = {
  node: TreeNodeData;
  checked: boolean;
  onToggle: (node: TreeNodeData, checked: boolean) => void;
};

export function TreeNode({ node, checked, onToggle }: Props) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-zinc-100 px-3 text-sm" style={{ paddingLeft: `${12 + node.depth * 22}px` }}>
      <input type="checkbox" checked={checked} onChange={(event) => onToggle(node, event.target.checked)} aria-label={`Select ${node.title}`} />
      <span className="w-5 shrink-0 text-center" aria-hidden>{iconByKind[node.kind]}</span>
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-zinc-500">{node.kind.replace("_", " ")}</span>
      {node.error && <span className="truncate text-xs text-amber-700" title={node.error}>⚠️ {node.error}</span>}
    </div>
  );
}
