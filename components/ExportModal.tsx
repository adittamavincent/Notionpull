"use client";

import { useState, useEffect, useMemo } from "react";
import { Copy, Download, X, Check } from "lucide-react";
import { exportMarkdown, type ExportItem } from "@/lib/export";

type Props = {
  open: boolean;
  items: ExportItem[];
  titleById: Map<string, string>;
  onClose: () => void;
  showIdForRelationRollup: boolean;
  onToggleShowIdForRelationRollup: (val: boolean) => void;
  includePropertyIds?: boolean;
};

export function ExportModal({ open, items, titleById, onClose, showIdForRelationRollup, onToggleShowIdForRelationRollup, includePropertyIds = false }: Props) {
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && items.length > 0) {
      setOutput(exportMarkdown(items, { titleById, showIdForRelationRollup, includePropertyIds }));
    }
  }, [open, items, titleById, showIdForRelationRollup, includePropertyIds]);

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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            <button 
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                showIdForRelationRollup 
                  ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800" 
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
              onClick={() => onToggleShowIdForRelationRollup(!showIdForRelationRollup)}
              title="Toggle showing Notion IDs next to relation names"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showIdForRelationRollup ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"}`} />
              Relation IDs
            </button>
            <button 
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-all ${
                copied 
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 active:bg-emerald-100" 
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-95"
              }`} 
              onClick={copy}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600 animate-in fade-in zoom-in-75 duration-200" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy"}
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
        
        <pre className="flex-1 overflow-auto bg-zinc-950 p-6 text-xs font-mono leading-relaxed text-zinc-100 md:rounded-b-xl">
          <code><HighlightedCode text={output} /></code>
        </pre>
      </div>
    </div>
  );
}

function highlightJsonLine(line: string): React.ReactNode {
  const jsonTokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:))|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)|(true|false|null)|([{}[\]:,])/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = jsonTokenRegex.exec(line)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      parts.push(line.substring(lastIndex, matchIndex));
    }

    const [raw, key, , strVal, , numVal, boolNullVal, punct] = match;

    if (key) {
      parts.push(<span key={matchIndex} className="text-purple-300 font-medium">{key}</span>);
    } else if (strVal) {
      parts.push(<span key={matchIndex} className="text-orange-300">{strVal}</span>);
    } else if (numVal) {
      parts.push(<span key={matchIndex} className="text-blue-300">{numVal}</span>);
    } else if (boolNullVal) {
      parts.push(<span key={matchIndex} className="text-amber-400 font-medium">{boolNullVal}</span>);
    } else if (punct) {
      parts.push(<span key={matchIndex} className="text-zinc-400">{punct}</span>);
    }

    lastIndex = jsonTokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.substring(lastIndex));
  }

  return <span>{parts}</span>;
}

export function HighlightedCode({ text }: { text: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [clickedIndex, setClickedIndex] = useState<number | null>(null);

  const isJson = useMemo(() => {
    const trimmed = text.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }, [text]);

  // Parse lines into text/tag parts
  const parsedLines = useMemo(() => {
    // Tag pairing scanner
    const tagRegex = /<(\/?)([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>/g;
    const tagInfos: { tagIndex: number; pairTagIndex?: number; name: string; type: "start" | "end" | "self-closing" }[] = [];
    const stack: { name: string; tagIndex: number }[] = [];
    let tagCounter = 0;

    const tagsAtPositions: { start: number; end: number; info: typeof tagInfos[number] }[] = [];

    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const isEnd = match[1] === "/";
      const name = match[2];
      const isSelfClosing = match[4] === "/";
      const tagIndex = tagCounter++;

      const info: any = { tagIndex, name, type: isSelfClosing ? "self-closing" : isEnd ? "end" : "start" };
      tagInfos.push(info);
      tagsAtPositions.push({ start: match.index, end: tagRegex.lastIndex, info });

      if (!isSelfClosing) {
        if (isEnd) {
          let foundIndex = -1;
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === name) {
              foundIndex = i;
              break;
            }
          }
          if (foundIndex !== -1) {
            const startTag = stack[foundIndex];
            stack.splice(foundIndex, 1);
            info.pairTagIndex = startTag.tagIndex;
            tagInfos[startTag.tagIndex].pairTagIndex = tagIndex;
          }
        } else {
          stack.push({ name, tagIndex });
        }
      }
    }

    const lines = text.split("\n");
    let absoluteCharIndex = 0;

    return lines.map((line) => {
      const lineParts: any[] = [];
      const lineStartAbs = absoluteCharIndex;
      const lineEndAbs = absoluteCharIndex + line.length;

      const tagsInLine = tagsAtPositions.filter(
        (t) => t.start >= lineStartAbs && t.end <= lineEndAbs
      );

      let lastIndexInLine = 0;
      for (const tag of tagsInLine) {
        const relativeStart = tag.start - lineStartAbs;
        const relativeEnd = tag.end - lineStartAbs;

        if (relativeStart > lastIndexInLine) {
          lineParts.push({
            type: "text",
            text: line.substring(lastIndexInLine, relativeStart),
          });
        }

        lineParts.push({
          type: "tag",
          tagIndex: tag.info.tagIndex,
          pairTagIndex: tag.info.pairTagIndex,
          tagName: tag.info.name,
          tagType: tag.info.type,
          rawText: line.substring(relativeStart, relativeEnd),
        });

        lastIndexInLine = relativeEnd;
      }

      if (lastIndexInLine < line.length) {
        lineParts.push({
          type: "text",
          text: line.substring(lastIndexInLine),
        });
      }

      absoluteCharIndex += line.length + 1; // +1 for the newline
      return lineParts;
    });
  }, [text]);

  return (
    <>
      {parsedLines.map((lineParts, idx) => {
        // Simple Markdown lines
        if (lineParts.length === 1 && lineParts[0].type === "text") {
          const line = lineParts[0].text;
          let content: React.ReactNode = line;
          
          if (isJson) {
            content = highlightJsonLine(line);
          } else if (line.trim().startsWith("<!--") && line.trim().endsWith("-->")) {
            content = <span className="text-zinc-500 italic">{line}</span>;
          } else if (line.startsWith("#")) {
            content = <span className="text-blue-400 font-bold">{line}</span>;
          } else if (line === "---") {
            content = <span className="text-zinc-600 font-bold">{line}</span>;
          } else if (/^\s*-\s+\[.*\]/.test(line)) {
            const match = line.match(/^(\s*-\s+\[)([^\]]+)(\]\s+)(.*)$/);
            if (match) {
              const [, indentDash, kind, closeBracket, rest] = match;
              content = (
                <span>
                  <span className="text-zinc-500">{indentDash}</span>
                  <span className="text-amber-400 font-medium">{kind}</span>
                  <span className="text-zinc-500">{closeBracket}</span>
                  <span className="text-zinc-200">{rest}</span>
                </span>
              );
            }
          } else if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
            const leadingWhitespaceMatch = line.match(/^(\s*)/);
            const indentStr = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : "";
            const trimmedLine = line.trim();
            const cells = trimmedLine.split(/(?<!\\)\|/);
            const isSeparator = cells.slice(1, -1).every((cell: string) => /^\s*:?-+:?\s*$/.test(cell));
            if (isSeparator) {
              content = <span className="text-zinc-600">{line}</span>;
            } else {
              const colors = [
                "text-red-400",
                "text-orange-400",
                "text-yellow-300",
                "text-emerald-400",
                "text-cyan-400",
                "text-blue-400",
                "text-indigo-400",
                "text-purple-400",
                "text-pink-400"
              ];
              content = (
                <span>
                  {indentStr}
                  {cells.map((cell: string, cellIdx: number) => {
                    if (cellIdx === 0) return null;
                    if (cellIdx === cells.length - 1) {
                      return <span key={cellIdx} className="text-zinc-600">|</span>;
                    }
                    const colorClass = colors[(cellIdx - 1) % colors.length];
                    return (
                      <span key={cellIdx}>
                        <span className="text-zinc-600">|</span>
                        <span className={colorClass}>{cell}</span>
                      </span>
                    );
                  })}
                </span>
              );
            }
          }

          return (
            <div key={idx} className="min-h-[1.25rem] whitespace-pre">
              {content}
            </div>
          );
        }

        // Mixed/XML tag lines
        return (
          <div key={idx} className="min-h-[1.25rem] whitespace-pre">
            {lineParts.map((part, pIdx) => {
              if (part.type === "text") {
                return <span key={pIdx}>{isJson ? highlightJsonLine(part.text) : part.text}</span>;
              }

              const isHighlighted = 
                hoveredIndex === part.tagIndex || 
                (hoveredIndex !== null && hoveredIndex === part.pairTagIndex) ||
                clickedIndex === part.tagIndex ||
                (clickedIndex !== null && clickedIndex === part.pairTagIndex);

              return (
                <HighlightedTag
                  key={pIdx}
                  part={part}
                  isActive={isHighlighted}
                  onHover={() => {
                    if (part.tagType !== "self-closing") {
                      setHoveredIndex(part.tagIndex);
                    }
                  }}
                  onLeave={() => {
                    setHoveredIndex(null);
                  }}
                  onClick={() => {
                    if (part.tagType !== "self-closing") {
                      setClickedIndex(clickedIndex === part.tagIndex ? null : part.tagIndex);
                    }
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function HighlightedTag({ 
  part, 
  isActive, 
  onHover, 
  onLeave, 
  onClick 
}: { 
  part: any; 
  isActive: boolean; 
  onHover: () => void; 
  onLeave: () => void; 
  onClick: () => void; 
}) {
  const text = part.rawText;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  const tagRegex = /(<\/?[a-zA-Z0-9_\-]+)|(\/?>)|([a-zA-Z0-9_\-]+)\s*=\s*("[^"]*")|(".*?")/g;
  let match;
  
  while ((match = tagRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }
    
    if (match[1]) {
      parts.push(<span key={matchIndex} className="text-emerald-400 font-medium">{match[1]}</span>);
    } else if (match[2]) {
      parts.push(<span key={matchIndex} className="text-emerald-400 font-medium">{match[2]}</span>);
    } else if (match[3] && match[4]) {
      parts.push(
        <span key={matchIndex}>
          <span className="text-purple-300">{match[3]}</span>
          <span className="text-zinc-400">=</span>
          <span className="text-orange-300">{match[4]}</span>
        </span>
      );
    } else if (match[5]) {
      parts.push(<span key={matchIndex} className="text-orange-300">{match[5]}</span>);
    }
    
    lastIndex = tagRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return (
    <span
      className={`cursor-pointer transition-all duration-150 rounded px-0.5 ${
        isActive 
          ? "bg-yellow-500/25 ring-1 ring-yellow-400/50 text-yellow-100 font-bold" 
          : "hover:bg-zinc-800"
      }`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {parts}
    </span>
  );
}

