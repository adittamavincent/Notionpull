"use client";

import { useState, useEffect } from "react";
import { Copy, Download, RotateCcw, X } from "lucide-react";
import { exportMarkdown, exportCsv, type ExportItem } from "@/lib/export";

type Props = {
  open: boolean;
  items: ExportItem[];
  titleById: Map<string, string>;
  onClose: () => void;
  onClear: () => void;
};

export function ExportModal({ open, items, titleById, onClose, onClear }: Props) {
  const [format, setFormat] = useState<"markdown" | "csv">("markdown");
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (open && items.length > 0) {
      if (format === "markdown") {
        setOutput(exportMarkdown(items, { titleById }));
      } else {
        setOutput(exportCsv(items, { titleById }));
      }
    }
  }, [open, items, titleById, format]);

  if (!open) return null;
  const ext = format === "markdown" ? "md" : "csv";

  async function copy() {
    await navigator.clipboard.writeText(output);
  }

  function download() {
    const blob = new Blob([output], { type: format === "markdown" ? "text/markdown" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `notionpull-export.${ext}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white/50 backdrop-blur-md">
      <div className="flex h-full flex-col bg-white shadow-2xl md:mx-auto md:my-10 md:h-auto md:max-h-[85vh] md:w-full md:max-w-5xl md:rounded-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3 md:rounded-t-xl">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-zinc-900">Export output</h2>
            
            <div className="flex rounded-md border border-zinc-300 bg-white p-0.5 shadow-sm">
              <button 
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${format === "markdown" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} 
                onClick={() => setFormat("markdown")}
              >
                Markdown
              </button>
              <button 
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${format === "csv" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} 
                onClick={() => setFormat("csv")}
              >
                CSV
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={copy}>
              <Copy className="h-4 w-4" /> Copy
            </button>
            <button className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={download}>
              <Download className="h-4 w-4" /> Download .{ext}
            </button>
            <div className="mx-2 h-5 w-px bg-zinc-300" />
            <button className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800" onClick={onClear}>
              <RotateCcw className="h-4 w-4" /> Clear & Start Over
            </button>
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
