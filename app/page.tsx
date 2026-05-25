"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ContentTree, flattenTree } from "@/components/ContentTree";
import { ExportModal } from "@/components/ExportModal";
import { TokenManager } from "@/components/TokenManager";
import { exportCsv, exportMarkdown, type ExportItem } from "@/lib/export";
import { firstTitleProperty, formatNotionId } from "@/lib/notion";
import { getActiveTokenLabel, getTokens } from "@/lib/tokens";
import type { DetectedObject, NotionBlock, NotionPage, NotionTokenEntry, RowsResponse, TreeNodeData } from "@/types/notion";

type DepthOption = "1" | "2" | "3" | "All";
type ExportFormat = "markdown" | "csv";

const depthOptions: DepthOption[] = ["1", "2", "3", "All"];

export default function Page() {
  const [tokens, setTokens] = useState<NotionTokenEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<DetectedObject | null>(null);
  const [nodes, setNodes] = useState<TreeNodeData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<DepthOption>("2");
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [exporting, setExporting] = useState(false);
  const [output, setOutput] = useState("");

  useEffect(() => refreshTokens(), []);

  const activeToken = useMemo(() => tokens.find((token) => token.label === activeLabel) ?? null, [tokens, activeLabel]);
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  const selectedNodes = useMemo(() => flatNodes.filter((node) => selected.has(node.id)), [flatNodes, selected]);

  function refreshTokens() {
    const nextTokens = getTokens();
    const nextActive = getActiveTokenLabel() ?? nextTokens[0]?.label ?? null;
    setTokens(nextTokens);
    setActiveLabel(nextActive);
  }

  async function submitUrl(event: FormEvent) {
    event.preventDefault();
    if (!activeToken) return;
    setError("");
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    try {
      const id = formatNotionId(url);
      const object = await apiFetch<DetectedObject>(activeToken.token, `/api/notion/detect?id=${encodeURIComponent(id)}`);
      setDetected(object);
      await loadTree(object);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadTree(object = detected) {
    if (!activeToken || !object) return;
    setLoadingTree(true);
    setError("");
    setSelected(new Set());
    try {
      const maxDepth = depth === "All" ? Infinity : Number(depth);
      const root = await buildNode(activeToken.token, {
        id: object.id,
        title: object.title,
        kind: object.type,
        depth: 0,
        dataSourceId: object.dataSourceId
      }, maxDepth);
      setNodes([root]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    if (detected && activeToken) void loadTree(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  function toggleNode(node: TreeNodeData, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const related = flattenTree([node]).map((item) => item.id);
      for (const id of related) checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(flatNodes.map((node) => node.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function runExport() {
    if (!activeToken || !selectedNodes.length) return;
    setExporting(true);
    setError("");
    try {
      const items: ExportItem[] = [];
      for (const node of selectedNodes) {
        if (node.error) continue;
        if (node.kind === "database" || node.kind === "data_source") {
          const dataSourceId = node.dataSourceId ?? (await apiFetch<{ dataSourceId: string }>(activeToken.token, `/api/notion/database/${node.id}`)).dataSourceId;
          const rows = await fetchAllRows(activeToken.token, dataSourceId);
          items.push({ kind: node.kind, title: node.title, rows });
        } else {
          let blocks: NotionBlock[] = [];
          try {
            blocks = (await apiFetch<{ results: NotionBlock[] }>(activeToken.token, `/api/notion/page/${node.id}/content`)).results;
          } catch {
            blocks = [];
          }
          items.push({ kind: node.kind, title: node.title, page: node.page, blocks });
        }
      }
      setOutput(format === "markdown" ? exportMarkdown(items) : exportCsv(items));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  function clearWork() {
    setUrl("");
    setDetected(null);
    setNodes([]);
    setSelected(new Set());
    setOutput("");
    setError("");
  }

  return (
    <main className="min-h-screen pb-24">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold">Notionpull</h1>
            <p className="text-xs text-zinc-500">{activeToken?.workspaceName ?? "No active workspace"}</p>
          </div>
          <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50" onClick={() => setManagerOpen(true)}>
            Tokens
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        {!activeToken ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="max-w-md rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
              <h2 className="text-base font-semibold">Add Notion token</h2>
              <p className="mt-2 text-sm text-zinc-500">Save workspace token before fetching content.</p>
              <button className="mt-5 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" onClick={() => setManagerOpen(true)}>
                Add token
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <form className="rounded-lg border border-zinc-200 bg-white p-4" onSubmit={submitUrl}>
              <label className="mb-2 block text-sm font-medium">Paste a Notion page or database URL</label>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.notion.so/..."
                />
                <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400" disabled={loadingTree}>
                  Fetch
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detected && <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium uppercase text-zinc-600">{detected.type.replace("_", " ")} · {detected.title}</span>}
                {error && <span className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</span>}
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-md border border-zinc-300 bg-white p-1">
                {depthOptions.map((option) => (
                  <button
                    key={option}
                    className={`rounded px-3 py-1.5 text-sm ${depth === option ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
                    onClick={() => setDepth(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50" onClick={selectAll} disabled={!flatNodes.length}>Select All</button>
                <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50" onClick={deselectAll} disabled={!flatNodes.length}>Deselect All</button>
              </div>
            </div>

            <ContentTree nodes={nodes} selected={selected} loading={loadingTree} onToggle={toggleNode} />
          </div>
        )}
      </div>

      {activeToken && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white px-5 py-3 shadow-lg">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="text-sm text-zinc-600">{selected.size} selected</div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-zinc-300 p-1">
                {(["markdown", "csv"] as ExportFormat[]).map((option) => (
                  <button key={option} className={`rounded px-3 py-1.5 text-sm ${format === option ? "bg-zinc-950 text-white" : "text-zinc-600"}`} onClick={() => setFormat(option)}>
                    {option === "markdown" ? "Markdown" : "CSV"}
                  </button>
                ))}
              </div>
              <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-400" onClick={runExport} disabled={exporting}>
                {exporting ? "Exporting..." : "Export Selected"}
              </button>
            </div>
          </div>
        </div>
      )}

      <TokenManager open={managerOpen} tokens={tokens} activeLabel={activeLabel} onClose={() => setManagerOpen(false)} onChange={refreshTokens} />
      <ExportModal open={Boolean(output)} format={format} output={output} onClose={() => setOutput("")} onClear={clearWork} />
    </main>
  );
}

async function buildNode(token: string, node: TreeNodeData, maxDepth: number): Promise<TreeNodeData> {
  if (node.depth >= maxDepth) return node;
  try {
    if (node.kind === "page") {
      const body = await apiFetch<{ results: Array<{ id: string; type: "page" | "database"; title: string }> }>(token, `/api/notion/page/${node.id}/children`);
      node.children = await Promise.all(body.results.map((child) => buildNode(token, {
        id: child.id,
        title: child.title,
        kind: child.type,
        depth: node.depth + 1,
        parentId: node.id
      }, maxDepth)));
    }
    if (node.kind === "database") {
      const database = await apiFetch<{ dataSourceId: string; title: string }>(token, `/api/notion/database/${node.id}`);
      node.dataSourceId = database.dataSourceId;
      node.children = await rowNodes(token, database.dataSourceId, node.depth + 1, node.id);
    }
    if (node.kind === "data_source") {
      node.children = await rowNodes(token, node.dataSourceId ?? node.id, node.depth + 1, node.id);
    }
  } catch (err) {
    node.error = errorMessage(err);
  }
  return node;
}

async function rowNodes(token: string, dataSourceId: string, depth: number, parentId: string): Promise<TreeNodeData[]> {
  const rows = await fetchAllRows(token, dataSourceId);
  return rows.map((row) => ({
    id: row.id,
    title: firstTitleProperty(row),
    kind: "row",
    depth,
    parentId,
    page: row
  }));
}

async function fetchAllRows(token: string, dataSourceId: string): Promise<NotionPage[]> {
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const body = await apiFetch<RowsResponse>(token, `/api/notion/datasource/${dataSourceId}/rows${qs}`);
    rows.push(...body.results);
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return rows;
}

async function apiFetch<T>(token: string, url: string, attempt = 0): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-notion-token": token } });
  } catch {
    throw new Error("Could not reach Notion — check your connection");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return apiFetch<T>(token, url, attempt + 1);
  }
  if (!response.ok) throw new Error(mapHttpError(response.status, body.error));
  return body as T;
}

function mapHttpError(status: number, detail?: string): string {
  if (status === 401) return "Token invalid or expired — check your Notion token";
  if (status === 404) return "Not found — make sure the integration has access to this page (Share → Invite integration)";
  if (status === 429) return "Rate limited — waiting 2 seconds...";
  return detail ?? "Unexpected error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
