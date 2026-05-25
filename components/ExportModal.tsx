"use client";

type Props = {
  open: boolean;
  format: "markdown" | "csv";
  output: string;
  onClose: () => void;
  onClear: () => void;
};

export function ExportModal({ open, format, output, onClose, onClear }: Props) {
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
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
        <h2 className="text-sm font-semibold">Export output</h2>
        <div className="flex gap-2">
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50" onClick={copy}>Copy</button>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50" onClick={download}>Download .{ext}</button>
          <button className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm text-white" onClick={onClear}>Clear & Start Over</button>
          <button className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100" onClick={onClose}>Close</button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto bg-zinc-950 p-5 text-sm leading-6 text-zinc-100"><code>{output}</code></pre>
    </div>
  );
}
