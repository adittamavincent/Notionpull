"use client";

import { useState, useEffect } from "react";
import { Copy, Download, X } from "lucide-react";
import { exportMarkdown, type ExportItem } from "@/lib/export";

type Props = {
  open: boolean;
  items: ExportItem[];
  titleById: Map<string, string>;
  onClose: () => void;
};

export function ExportModal({ open, items, titleById, onClose }: Props) {
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (open && items.length > 0) {
      setOutput(exportMarkdown(items, { titleById }));
    }
  }, [open, items, titleById]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function copy() {
    await navigator.clipboard.writeText(output);
  }

  function download() {
    const blob = new Blob([output], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `notionpull-export.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/50 backdrop-blur-md p-4 md:p-10" onClick={onClose}>
      <div className="flex h-full w-full flex-col bg-white shadow-2xl md:max-h-[85vh] md:max-w-5xl rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3 md:rounded-t-xl">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-zinc-900">Export</h2>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={copy}>
              <Copy className="h-4 w-4" /> Copy
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={download}>
              <Download className="h-4 w-4" /> Download
            </button>
            <div className="mx-2 h-5 w-px bg-zinc-300" />
            <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        <pre className="flex-1 overflow-auto bg-zinc-950 p-6 text-sm leading-relaxed text-zinc-100 md:rounded-b-xl">
          <code>{output}</code>
        </pre>
      </div>
    </div>
  );
}
