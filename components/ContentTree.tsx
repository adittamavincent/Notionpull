"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TreeNodeData } from "@/types/notion";
import { TreeNode } from "@/components/TreeNode";

type Props = {
  nodes: TreeNodeData[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (node: TreeNodeData, checked: boolean) => void;
};

export function flattenTree(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

export function ContentTree({ nodes, selected, loading, onToggle }: Props) {
  const flat = useMemo(() => flattenTree(nodes), [nodes]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12
  });

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="mb-2 h-8 animate-pulse rounded bg-zinc-100" />
        ))}
      </div>
    );
  }

  if (!flat.length) {
    return <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">No child pages, databases, or rows found.</div>;
  }

  if (flat.length <= 200) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {flat.map((node) => <TreeNode key={node.id} node={node} checked={selected.has(node.id)} onToggle={onToggle} />)}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-[560px] overflow-auto rounded-lg border border-zinc-200 bg-white">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const node = flat[item.index];
          return (
            <div key={node.id} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${item.start}px)` }}>
              <TreeNode node={node} checked={selected.has(node.id)} onToggle={onToggle} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
