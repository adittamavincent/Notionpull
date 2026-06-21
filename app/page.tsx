"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FinderTree, flattenTree } from "@/components/FinderTree";
import { DatabaseConfigModal } from "@/components/DatabaseConfigModal";
import { ExportModal } from "@/components/ExportModal";
import { ExportProgress } from "@/components/ExportProgress";
import { TokenManager } from "@/components/TokenManager";
import { DebugModal } from "@/components/DebugModal";
import { type ExportItem } from "@/lib/export";
import { extractNotionIds, firstTitleProperty, propertyValue } from "@/lib/notion";
import { getActiveTokenLabel, getTokens } from "@/lib/tokens";
import type { DetectedObject, NotionBlock, NotionPage, NotionTokenEntry, RowsResponse, TreeNodeData } from "@/types/notion";
import { History, RefreshCw, LogOut, X, FileText, Database, Table2, Bookmark, Download, Upload } from "lucide-react";
import Image from "next/image";

type DepthOption = "Surface" | "1" | "2" | "3" | "4" | "5" | "All";

const depthOptions: DepthOption[] = ["Surface", "1", "2", "3", "4", "5", "All"];

export interface HistoryItem {
  url: string;
  title: string;
  type: string;
}

export interface Preset {
  id: string;
  name: string;
  urls: string[];
}

function normalizeUrl(url: string): string {
  let cleaned = url.trim().toLowerCase();
  cleaned = cleaned.replace(/^(https?:\/\/)?(www\.)?/, "");
  cleaned = cleaned.replace(/\/+$/, "");
  return cleaned;
}

function highlightNotionUrl(url: string) {
  if (!url) return "";
  
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  const regex = /^(https?:\/\/)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?(\/[a-zA-Z0-9-._~:\/]*?([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?(\?[^#]*)?(#.*)?$/i;
  const match = url.match(regex);

  if (!match) {
    return `<span class="text-zinc-600">${escapeHtml(url)}</span>`;
  }

  const [_, protocol = "", domain = "", pathAndId = "", id = "", query = "", hash = ""] = match;

  let path = "";
  if (pathAndId && id) {
    const idx = pathAndId.lastIndexOf(id);
    if (idx !== -1) {
      path = pathAndId.substring(0, idx);
    }
  }

  let html = "";
  if (protocol) html += `<span class="text-zinc-400/80">${escapeHtml(protocol)}</span>`;
  if (domain) html += `<span class="text-emerald-600">${escapeHtml(domain)}</span>`;
  if (path) html += `<span class="text-zinc-500">${escapeHtml(path)}</span>`;
  if (id) html += `<span class="text-violet-600">${escapeHtml(id)}</span>`;
  if (query) {
    const highlightedQuery = query.replace(/([\?&])([^=&\s]+)(=[^&\s]*)?/g, (m, sep, key, val) => {
      let segment = `<span class="text-zinc-400">${escapeHtml(sep)}</span><span class="text-amber-600">${escapeHtml(key)}</span>`;
      if (val) {
        segment += `<span class="text-zinc-400">=</span><span class="text-cyan-600">${escapeHtml(val.substring(1))}</span>`;
      }
      return segment;
    });
    html += highlightedQuery;
  }
  if (hash) html += `<span class="text-zinc-400">${escapeHtml(hash)}</span>`;

  return html;
}

export default function Page() {
  const [tokens, setTokens] = useState<NotionTokenEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const [urls, setUrls] = useState<string[]>([""]);
  const [activeInputIndex, setActiveInputIndex] = useState<number>(0);
  const [urlHistory, setUrlHistory] = useState<HistoryItem[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [username, setUsername] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [detectedList, setDetectedList] = useState<DetectedObject[]>([]);
  const [detectingUrls, setDetectingUrls] = useState<Set<string>>(new Set());
  const detected = detectedList[0] ?? null;
  const [nodes, setNodes] = useState<TreeNodeData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isRefetch = useMemo(() => {
    const activeUrls = urls.map(u => u.trim()).filter(Boolean);
    if (activeUrls.length === 0) return false;
    return activeUrls.every(url => {
      const ids = extractNotionIds(url);
      const matchedDet = detectedList.find(d => ids.includes(d.id));
      if (!matchedDet) return false;
      return nodes.some(n => n.id === matchedDet.id);
    });
  }, [urls, detectedList, nodes]);

  // Requirement: Default depth 1 (now Surface)
  const [depth, setDepth] = useState<DepthOption>("Surface");
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState("");

  const [showRelationIds, setShowRelationIds] = useState(false);
  const [fetchLinkedChildren, setFetchLinkedChildren] = useState(false);
  const [fetchDatabaseRelations, setFetchDatabaseRelations] = useState(false);
  const [fetchComments, setFetchComments] = useState(false);
  const [maxChildrenMap, setMaxChildrenMap] = useState<Record<DepthOption, number>>({
    Surface: 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    All: 0
  });
  const maxChildren = maxChildrenMap[depth];
  const [resetLog, setResetLog] = useState(true);
  const [hoveredDepth, setHoveredDepth] = useState<DepthOption | null>(null);
  const [depthContainer, setDepthContainer] = useState<HTMLDivElement | null>(null);

  // Load from localStorage on mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("notionpull_username");
      if (savedUser) {
        setUsername(savedUser);
        fetch(`/api/session?username=${encodeURIComponent(savedUser)}`)
          .then((res) => res.json())
          .then((val) => {
            if (val && !val.error) {
              if (val.urls) setUrls(val.urls);
              if (val.detectedList) setDetectedList(val.detectedList);
              if (val.nodes) setNodes(val.nodes);
              if (val.urlHistory) setUrlHistory(val.urlHistory);
              if (val.depth) setDepth(val.depth);
              if (val.showRelationIds !== undefined) setShowRelationIds(val.showRelationIds);
              if (val.fetchLinkedChildren !== undefined) setFetchLinkedChildren(val.fetchLinkedChildren);
              if (val.fetchDatabaseRelations !== undefined) setFetchDatabaseRelations(val.fetchDatabaseRelations);
              if (val.fetchComments !== undefined) setFetchComments(val.fetchComments);
              if (val.maxChildrenMap) setMaxChildrenMap(val.maxChildrenMap);
              if (val.resetLog !== undefined) setResetLog(val.resetLog);
              if (val.selected) setSelected(new Set(val.selected));
            }
            setSessionLoaded(true);
          })
          .catch(() => setSessionLoaded(true));
      } else {
        setSessionLoaded(true);
      }

      const saved = localStorage.getItem("notionpull_show_relation_ids");
      if (saved !== null) {
        setShowRelationIds(saved === "true");
      }
      const savedLinked = localStorage.getItem("notionpull_fetch_linked_children");
      if (savedLinked !== null) {
        setFetchLinkedChildren(savedLinked === "true");
      }
      const savedRelations = localStorage.getItem("notionpull_fetch_database_relations");
      if (savedRelations !== null) {
        setFetchDatabaseRelations(savedRelations === "true");
      }
      const savedMaxChildrenMap = localStorage.getItem("notionpull_max_children_map");
      if (savedMaxChildrenMap !== null) {
        try {
          setMaxChildrenMap(JSON.parse(savedMaxChildrenMap));
        } catch { }
      } else {
        const savedMaxChildren = localStorage.getItem("notionpull_max_children");
        if (savedMaxChildren !== null) {
          const val = Number(savedMaxChildren);
          setMaxChildrenMap({
            Surface: val,
            "1": val,
            "2": val,
            "3": val,
            "4": val,
            "5": val,
            All: val
          });
        }
      }
      const savedResetLog = localStorage.getItem("notionpull_reset_log");
      if (savedResetLog !== null) {
        setResetLog(savedResetLog === "true");
      }
      const savedComments = localStorage.getItem("notionpull_fetch_comments");
      if (savedComments !== null) {
        setFetchComments(savedComments === "true");
      }
      const savedDepth = localStorage.getItem("notionpull_depth");
      if (savedDepth !== null) {
        setDepth(savedDepth as DepthOption);
      }
    } catch { }
  }, []);

  useEffect(() => {
    if (username && sessionLoaded) {
      const stateToSave = {
        urls,
        detectedList,
        nodes,
        urlHistory,
        depth,
        showRelationIds,
        fetchLinkedChildren,
        fetchDatabaseRelations,
        fetchComments,
        maxChildrenMap,
        resetLog,
        selected: Array.from(selected)
      };
      
      // Debounce the save operation to avoid spamming the server on rapid UI changes
      const timeoutId = setTimeout(() => {
        fetch(`/api/session?username=${encodeURIComponent(username)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stateToSave)
        }).catch(err => console.error("Failed to save session", err));
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [username, sessionLoaded, urls, detectedList, nodes, urlHistory, depth, showRelationIds, fetchLinkedChildren, fetchDatabaseRelations, fetchComments, maxChildrenMap, resetLog, selected]);

  const handleDepthChange = (val: DepthOption) => {
    setDepth(val);
    try {
      localStorage.setItem("notionpull_depth", val);
    } catch { }
  };

  const handleUrlScroll = (e: React.UIEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const container = input.parentElement;
    if (container) {
      const overlay = container.querySelector(".url-highlight-overlay") as HTMLDivElement | null;
      if (overlay) {
        overlay.scrollLeft = input.scrollLeft;
      }
    }
  };

  const handleShowRelationIdsChange = (val: boolean) => {
    setShowRelationIds(val);
    try {
      localStorage.setItem("notionpull_show_relation_ids", String(val));
    } catch { }
  };

  const handleFetchLinkedChildrenChange = (val: boolean) => {
    setFetchLinkedChildren(val);
    try {
      localStorage.setItem("notionpull_fetch_linked_children", String(val));
    } catch { }
  };

  const handleFetchDatabaseRelationsChange = (val: boolean) => {
    setFetchDatabaseRelations(val);
    try {
      localStorage.setItem("notionpull_fetch_database_relations", String(val));
    } catch { }
  };

  const handleFetchCommentsChange = (val: boolean) => {
    setFetchComments(val);
    try {
      localStorage.setItem("notionpull_fetch_comments", String(val));
    } catch { }
  };

  const handleMaxChildrenChange = (val: number) => {
    setMaxChildrenMap(prev => {
      const next = { ...prev, [depth]: val };
      try {
        localStorage.setItem("notionpull_max_children_map", JSON.stringify(next));
      } catch { }
      return next;
    });
  };

  const handleResetLogChange = (val: boolean) => {
    setResetLog(val);
    try {
      localStorage.setItem("notionpull_reset_log", String(val));
    } catch { }
  };

  // Handle wheel scrolling over depth options to adjust limits
  useEffect(() => {
    if (!depthContainer) return;
    const el = depthContainer;

    const handleWheelEvent = (e: WheelEvent) => {
      const btn = (e.target as HTMLElement).closest("button[data-depth-option]");
      if (!btn) return;
      const option = btn.getAttribute("data-depth-option") as DepthOption;
      if (!option) return;

      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      
      setMaxChildrenMap(prev => {
        const currentVal = prev[option];
        const newVal = Math.max(0, currentVal + direction);
        const next = { ...prev, [option]: newVal };
        try {
          localStorage.setItem("notionpull_max_children_map", JSON.stringify(next));
        } catch { }
        return next;
      });
    };

    el.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheelEvent);
    };
  }, []);

  // Handle keyboard up/down arrows when a depth option is hovered
  useEffect(() => {
    if (!hoveredDepth) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const direction = e.key === "ArrowUp" ? 1 : -1;
        setMaxChildrenMap(prev => {
          const currentVal = prev[hoveredDepth];
          const newVal = Math.max(0, currentVal + direction);
          const next = { ...prev, [hoveredDepth]: newVal };
          try {
            localStorage.setItem("notionpull_max_children_map", JSON.stringify(next));
          } catch { }
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hoveredDepth]);

  // Reactively update custom preview node titles when showRelationIds changes
  useEffect(() => {
    setNodes((prevNodes) => {
      const updateTreeTitles = (list: TreeNodeData[]): TreeNodeData[] => {
        return list.map((n) => {
          let updatedChildren = n.children;
          if (updatedChildren) {
            updatedChildren = updatedChildren.map((child) => {
              if (child.kind === "row" && child.page) {
                const page = child.page;
                let newTitle = "";
                if (n.previewColumns && n.previewColumns.length > 0) {
                  newTitle = n.previewColumns
                    .map((col) => propertyValue(page.properties?.[col], { showIdForRelationRollup: showRelationIds }))
                    .filter(Boolean)
                    .join(" · ");
                } else {
                  newTitle = firstTitleProperty(page);
                }
                return { ...child, title: newTitle || "Untitled" };
              }
              return child;
            });
          }
          return {
            ...n,
            children: updatedChildren ? updateTreeTitles(updatedChildren) : undefined,
          };
        });
      };
      return updateTreeTitles(prevNodes);
    });
  }, [showRelationIds]);

  // Database Config State
  const [configNode, setConfigNode] = useState<TreeNodeData | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // Export Progress State
  const [exporting, setExporting] = useState(false);
  const [exportTotal, setExportTotal] = useState(0);
  const [exportCurrent, setExportCurrent] = useState(0);
  const [exportStatus, setExportStatus] = useState("");

  // Export Modal State
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());

  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [relativeTime, setRelativeTime] = useState("");

  // Caching
  const treeCache = useRef<Map<string, TreeNodeData>>(new Map());
  const pageChildrenCache = useRef<Map<string, Promise<PageChildrenResponse>>>(new Map());
  const contentCache = useRef<Map<string, Promise<{ results: NotionBlock[]; comments?: any[] }>>>(new Map());
  const databaseCache = useRef<Map<string, Promise<DatabaseResponse>>>(new Map());
  const rowsCache = useRef<Map<string, Promise<NotionPage[]>>>(new Map());
  const titleCache = useRef<Map<string, string>>(new Map());
  const treeAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => refreshTokens(), []);

  // Load URL History from LocalStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notionpull_history_v2");
      if (saved) {
        const history = JSON.parse(saved);
        if (Array.isArray(history)) {
          setUrlHistory(history);
        }
      }
    } catch { }
  }, []);

  const saveUrlHistory = (newUrl: string, title?: string, type?: string) => {
    try {
      if (!type) return;
      const displayTitle = (title && title.trim()) ? title.trim() : "Untitled";

      let hist: HistoryItem[] = [];
      try {
        const saved = localStorage.getItem("notionpull_history_v2");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            hist = parsed;
          }
        }
      } catch { }

      const newItem: HistoryItem = { url: newUrl, title: displayTitle, type };
      const updated = [newItem, ...hist.filter((h: HistoryItem) => normalizeUrl(h.url) !== normalizeUrl(newUrl))].slice(0, 10);
      localStorage.setItem("notionpull_history_v2", JSON.stringify(updated));
      setUrlHistory(updated);
    } catch { }
  };

  const removeUrlHistory = (url: string) => {
    try {
      const updated = urlHistory.filter((h) => normalizeUrl(h.url) !== normalizeUrl(url));
      localStorage.setItem("notionpull_history_v2", JSON.stringify(updated));
      setUrlHistory(updated);
    } catch { }
  };

  // Load Presets from LocalStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notionpull_presets");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPresets(parsed);
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    };
    if (exportDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [exportDropdownOpen]);

  const savePreset = (name: string) => {
    if (!name.trim()) return;
    const activeUrls = urls.map(u => u.trim()).filter(Boolean);
    if (!activeUrls.length) return;
    const newPreset: Preset = {
      id: Date.now().toString(),
      name: name.trim(),
      urls: activeUrls
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    try {
      localStorage.setItem("notionpull_presets", JSON.stringify(updated));
    } catch { }
    setNewPresetName("");
    setShowSavePreset(false);
  };

  const removePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    try {
      localStorage.setItem("notionpull_presets", JSON.stringify(updated));
    } catch { }
  };

  const applyPreset = (preset: Preset) => {
    setUrls(preset.urls);
    triggerFetch(preset.urls);
  };

  const exportPresets = () => {
    try {
      const dataStr = JSON.stringify(presets, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "notionpull_presets.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export presets:", err);
    }
  };

  const exportSinglePreset = (preset: Preset) => {
    try {
      const dataStr = JSON.stringify([preset], null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeName = preset.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      link.download = `${safeName}_preset.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export preset:", err);
    }
  };

  const importPresets = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          const valid = parsed.every(
            (item) =>
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              Array.isArray(item.urls) &&
              item.urls.every((u: any) => typeof u === "string")
          );

          if (valid) {
            setPresets((prev) => {
              const existingIds = new Set(prev.map((p) => p.id));
              const merged = [...prev, ...parsed.filter((p) => !existingIds.has(p.id))];
              try {
                localStorage.setItem("notionpull_presets", JSON.stringify(merged));
              } catch { }
              return merged;
            });
          } else {
            setError("Invalid presets file format.");
          }
        } else {
          setError("Presets file must be a JSON array.");
        }
      } catch (err) {
        setError("Failed to parse presets file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const activeToken = useMemo(() => tokens.find((token) => token.label === activeLabel) ?? null, [tokens, activeLabel]);

  const isCurrentInputSavedAsPreset = useMemo(() => {
    const currentActiveUrls = urls.map(u => normalizeUrl(u)).filter(Boolean);
    if (!currentActiveUrls.length) return false;
    const sortedCurrent = [...currentActiveUrls].sort();
    return presets.some(preset => {
      const presetNormalized = preset.urls.map(u => normalizeUrl(u)).filter(Boolean);
      if (presetNormalized.length !== currentActiveUrls.length) return false;
      const sortedPreset = [...presetNormalized].sort();
      return sortedCurrent.every((u, i) => u === sortedPreset[i]);
    });
  }, [urls, presets]);

  const displayedHistory = useMemo(() => {
    const inputUrls = new Set(urls.map((u) => normalizeUrl(u)));
    return urlHistory.filter((item) => !inputUrls.has(normalizeUrl(item.url)));
  }, [urlHistory, urls]);
  const flatNodes = useMemo(() => flattenTree(nodes), [nodes]);
  // Use unique set of top-level selected nodes to avoid duplicates when parent and child are both selected
  const selectedNodes = useMemo(() => {
    return flatNodes.filter((node) => {
      if (!selected.has(node.id)) return false;

      // The root node is always kept
      if (!node.parentId) return true;

      const parentIsSelected = selected.has(node.parentId);

      // If the parent is selected:
      if (parentIsSelected) {
        // Databases/data sources are always kept to allow parent pages to dynamically embed them
        if (node.kind === "database" || node.kind === "data_source") return true;

        // Pages are kept only if they have selected children in the tree (so they are structural, not leaf links)
        if (node.kind === "page") {
          return node.children?.some(child => selected.has(child.id)) ?? false;
        }

        // Rows are explicitly exported if they are selected. No need to drop leaf rows, 
        // as the user explicitly ticked them and expects them to be exported standalone.
        if (node.kind === "row") {
          return true;
        }

        // Blocks are always rendered inline under their parent row/page — never export standalone
        return false;
      }

      // If the parent is NOT selected, we always keep the node to ensure it gets exported
      return true;
    });
  }, [flatNodes, selected]);

  useEffect(() => {
    if (!lastFetch) {
      setRelativeTime("");
      return;
    }

    const updateRelative = () => {
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - lastFetch.getTime()) / 1000);

      if (diffInSeconds < 5) setRelativeTime("just now");
      else if (diffInSeconds < 60) setRelativeTime(`${diffInSeconds}s ago`);
      else if (diffInSeconds < 3600) setRelativeTime(`${Math.floor(diffInSeconds / 60)}m ago`);
      else setRelativeTime(`${Math.floor(diffInSeconds / 3600)}h ago`);
    };

    updateRelative();
    const timer = setInterval(updateRelative, 10000);
    return () => clearInterval(timer);
  }, [lastFetch]);



  function refreshTokens() {
    const nextTokens = getTokens();
    const nextActive = getActiveTokenLabel() ?? nextTokens[0]?.label ?? null;
    setTokens(nextTokens);
    setActiveLabel(nextActive);
  }

  async function detectWithAnyToken(id: string, viewId?: string, signal?: AbortSignal): Promise<DetectedObject> {
    if (tokens.length === 0) {
      throw new Error("No tokens available. Add a token first.");
    }
    const results = await Promise.allSettled(
      tokens.map(async (t) => {
        const res = await apiFetch<DetectedObject>(t.token, `/api/notion/detect?id=${encodeURIComponent(id)}${viewId ? `&viewId=${encodeURIComponent(viewId)}` : ""}`, { signal });
        return { ...res, token: t.token };
      })
    );
    const successful = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<DetectedObject> | undefined;
    if (successful) return successful.value;
    const firstError = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstError?.reason || new Error("Failed to detect with all tokens");
  }

  const triggerQuickDetect = useCallback(async (url: string) => {
    if (loadingTree) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const ids = extractNotionIds(trimmed);
    if (!ids.length) return;

    const alreadyDetected = detectedList.some(d => ids.includes(d.id));
    if (alreadyDetected) return;

    setDetectingUrls(prev => {
      const next = new Set(prev);
      next.add(trimmed);
      return next;
    });

    let viewId = "";
    try {
      const parsedUrl = new URL(trimmed);
      viewId = parsedUrl.searchParams.get("v") || "";
    } catch { }

    try {
      const results = await Promise.allSettled(
        ids.map(id => detectWithAnyToken(id, viewId))
      );
      const successful = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<DetectedObject> | undefined;
      if (successful) {
        const detectedObj = successful.value;
        setDetectedList(prev => {
          const idx = prev.findIndex(d => d.id === detectedObj.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = detectedObj;
            return next;
          }
          return [...prev, detectedObj];
        });
      }
    } catch (err) {
      // Quietly ignore background errors
    } finally {
      setDetectingUrls(prev => {
        const next = new Set(prev);
        next.delete(trimmed);
        return next;
      });
    }
  }, [detectedList, tokens, loadingTree]);

  useEffect(() => {
    urls.forEach(url => {
      if (url.trim()) {
        triggerQuickDetect(url);
      }
    });
  }, [urls, triggerQuickDetect]);

  async function triggerFetch(targetUrls: string[]) {
    if (tokens.length === 0) return;

    const activeUrls = targetUrls.map(u => u.trim()).filter(Boolean);
    if (!activeUrls.length) return;

    const allIds = activeUrls.flatMap(url => extractNotionIds(url));
    if (allIds.length === 0) {
      setError("Could not find a valid Notion ID in the URL(s).");
      return;
    }

    if (resetLog) {
      try {
        await fetch("/api/notion/debug", { method: "DELETE" });
      } catch (err) {
        console.error("Failed to reset logs on fetch:", err);
      }
    }

    treeAbortRef.current?.abort();
    const controller = new AbortController();
    treeAbortRef.current = controller;
    setError("");
    setLoadingTree(true);
    setDetectedList([]);
    setNodes([]);
    setSelected(new Set());

    try {
      const detectedResults: DetectedObject[] = [];
      const errors: string[] = [];

      for (const singleUrl of activeUrls) {
        const ids = extractNotionIds(singleUrl);
        if (!ids.length) {
          errors.push(`Could not find a valid Notion ID in URL: ${singleUrl}`);
          continue;
        }

        let viewId = "";
        try {
          const parsedUrl = new URL(singleUrl);
          viewId = parsedUrl.searchParams.get("v") || "";
        } catch { }

        // Try all IDs with all tokens
        const results = await Promise.allSettled(
          ids.map(id => detectWithAnyToken(id, viewId, controller.signal))
        );

        const successful = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<DetectedObject> | undefined;

        if (successful) {
          detectedResults.push(successful.value);
          saveUrlHistory(singleUrl, successful.value.title, successful.value.type);
        } else {
          const firstError = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
          const errMsg = firstError?.reason ? errorMessage(firstError.reason) : `Could not detect any Notion object in URL: ${singleUrl}`;
          errors.push(errMsg);
        }
      }

      if (errors.length > 0) {
        setError(errors.join(" | "));
      }

      if (detectedResults.length > 0) {
        setDetectedList(detectedResults);
        await loadTree(detectedResults, depth, true, controller);
      } else {
        setLoadingTree(false);
      }
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
      setLoadingTree(false);
    } finally {
      if (treeAbortRef.current === controller) treeAbortRef.current = null;
    }
  }

  async function submitUrl(event: FormEvent) {
    event.preventDefault();
    await triggerFetch(urls);
  }

  const updateTreeNode = useCallback((nodeId: string, updater: (node: TreeNodeData) => TreeNodeData) => {
    setNodes(prev => {
      const walk = (list: TreeNodeData[]): TreeNodeData[] => {
        return list.map(n => {
          if (n.id === nodeId) {
            return updater(n);
          }
          if (n.children) {
            return { ...n, children: walk(n.children) };
          }
          return n;
        });
      };
      return walk(prev);
    });
  }, []);

  async function refetchUrl(index: number) {
    if (tokens.length === 0) return;
    const singleUrl = urls[index]?.trim();
    if (!singleUrl) return;

    setDetectingUrls(prev => {
      const next = new Set(prev);
      next.add(singleUrl);
      return next;
    });

    const ids = extractNotionIds(singleUrl);
    if (!ids.length) {
      setDetectingUrls(prev => {
        const next = new Set(prev);
        next.delete(singleUrl);
        return next;
      });
      setError("Could not find a valid Notion ID in URL.");
      return;
    }

    if (resetLog) {
      try {
        await fetch("/api/notion/debug", { method: "DELETE" });
      } catch (err) {
        console.error("Failed to reset logs on fetch:", err);
      }
    }

    treeAbortRef.current?.abort();
    const controller = new AbortController();
    treeAbortRef.current = controller;
    setError("");
    setLoadingTree(true);

    try {
      let viewId = "";
      try {
        const parsedUrl = new URL(singleUrl);
        viewId = parsedUrl.searchParams.get("v") || "";
      } catch { }

      const results = await Promise.allSettled(
        ids.map(id => detectWithAnyToken(id, viewId, controller.signal))
      );

      const successful = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<DetectedObject> | undefined;

      if (!successful) {
        const firstError = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
        const errMsg = firstError?.reason ? errorMessage(firstError.reason) : `Could not detect any Notion object in URL: ${singleUrl}`;
        setError(errMsg);
        setLoadingTree(false);
        return;
      }

      const detectedObj = successful.value;
      saveUrlHistory(singleUrl, detectedObj.title, detectedObj.type);

      // Clear caches to force fresh data fetching
      pageChildrenCache.current.clear();
      contentCache.current.clear();
      databaseCache.current.clear();
      rowsCache.current.clear();
      treeCache.current.clear();

      const maxDepth = depthValue(depth);
      const rootSeed: TreeNodeData = {
        id: detectedObj.id,
        title: detectedObj.title,
        kind: detectedObj.type,
        depth: 0,
        viewId: detectedObj.viewId,
        views: detectedObj.views,
        columnDetails: detectedObj.columnDetails,
        dataSourceId: detectedObj.dataSourceId,
        dataSourceName: detectedObj.dataSourceName,
        columns: detectedObj.columns,
        selectedColumns: detectedObj.selectedColumns,
        properties: detectedObj.properties,
        isLinkedDatabase: detectedObj.isLinkedDatabase,
        token: detectedObj.token,
        status: "PENDING"
      };

      // Initialize the root in nodes state first
      setNodes(prev => {
        const idx = prev.findIndex(n => n.id === rootSeed.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = rootSeed;
          return next;
        }
        return [...prev, rootSeed];
      });

      const nodeToken = detectedObj.token || activeToken?.token || "";
      const freshRoot = await buildNode(nodeToken, rootSeed, maxDepth, {
        pageChildren: pageChildrenCache.current,
        databases: databaseCache.current,
        rows: rowsCache.current,
        showIdForRelationRollup: showRelationIds,
        fetchLinkedChildren,
        fetchDatabaseRelations,
        fetchComments,
        maxChildrenMap,
        onNodeUpdated: updateTreeNode,
        signal: controller.signal
      });

      const cacheKey = treeCacheKey(detectedObj.id, depth, detectedObj.viewId);
      treeCache.current.set(cacheKey, freshRoot);

      setDetectedList(prev => {
        const idx = prev.findIndex(d => d.id === detectedObj.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = detectedObj;
          return next;
        }
        return [...prev, detectedObj];
      });

      setNodes(prev => {
        const idx = prev.findIndex(n => n.id === freshRoot.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = freshRoot;
          return next;
        }
        return [...prev, freshRoot];
      });

      setLastFetch(new Date());
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
    } finally {
      setDetectingUrls(prev => {
        const next = new Set(prev);
        next.delete(singleUrl);
        return next;
      });
      if (treeAbortRef.current === controller) treeAbortRef.current = null;
      setLoadingTree(false);
    }
  }

  async function loadTree(objects: DetectedObject[] = detectedList, currentDepth: DepthOption = depth, forceRefresh = false, controller?: AbortController) {
    if (tokens.length === 0 || !objects.length) return;
    if (!controller) {
      treeAbortRef.current?.abort();
      controller = new AbortController();
      treeAbortRef.current = controller;
    }
    setLoadingTree(true);
    setError("");
    if (forceRefresh) {
      pageChildrenCache.current.clear();
      contentCache.current.clear();
      databaseCache.current.clear();
      rowsCache.current.clear();
      treeCache.current.clear(); // Clear tree structure cache on refresh
    }

    // Check cache for ALL objects
    if (!forceRefresh) {
      const cachedRoots: TreeNodeData[] = [];
      let allCached = true;
      for (const object of objects) {
        const cached = getCachedTreeForDepth(treeCache.current, object.id, currentDepth, object.viewId);
        if (cached) {
          cachedRoots.push(cached);
        } else {
          allCached = false;
          break;
        }
      }
      if (allCached) {
        setNodes(cachedRoots);
        setLoadingTree(false);
        return;
      }
    }

    // Always start with empty selection after fetch
    setSelected(new Set());

    try {
      const maxDepth = depthValue(currentDepth);

      const initialRoots = objects.map((object) => {
        const rootSeed: TreeNodeData = {
          id: object.id,
          title: object.title,
          kind: object.type,
          depth: 0,
          viewId: object.viewId,
          views: object.views,
          columnDetails: object.columnDetails,
          dataSourceId: object.dataSourceId,
          dataSourceName: object.dataSourceName,
          columns: object.columns,
          selectedColumns: object.selectedColumns,
          properties: object.properties,
          isLinkedDatabase: object.isLinkedDatabase,
          token: object.token,
          status: "PENDING"
        };
        return rootSeed;
      });
      setNodes(initialRoots);

      const roots: TreeNodeData[] = [];
      for (const rootSeed of initialRoots) {
        const rootToken = rootSeed.token || activeToken?.token || "";
        const freshRoot = await buildNode(rootToken, rootSeed, maxDepth, {
          pageChildren: pageChildrenCache.current,
          databases: databaseCache.current,
          rows: rowsCache.current,
          showIdForRelationRollup: showRelationIds,
          fetchLinkedChildren,
          fetchDatabaseRelations,
          fetchComments,
          maxChildrenMap,
          onNodeUpdated: updateTreeNode,
          signal: controller!.signal
        });
        roots.push(freshRoot);
      }

      // Cache each root
      roots.forEach((root, idx) => {
        const object = objects[idx];
        const cacheKey = treeCacheKey(object.id, currentDepth, object.viewId);
        treeCache.current.set(cacheKey, root);
      });

      setNodes(roots);
      setLastFetch(new Date());
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
    } finally {
      if (treeAbortRef.current === controller) treeAbortRef.current = null;
      setLoadingTree(false);
    }
  }




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

  function handleConfigureDatabase(node: TreeNodeData) {
    setConfigNode(node);
    setConfigOpen(true);
  }

  function saveDatabaseConfig(nodeId: string, selectedColumns: string[], previewColumns?: string[]) {
    // Update the node in the current tree structure
    const updateNode = (list: TreeNodeData[]): TreeNodeData[] => {
      return list.map(n => {
        if (n.id === nodeId) {
          const updatedColumnDetails = n.columnDetails?.map(col => ({
            ...col,
            visible: selectedColumns.includes(col.name)
          }));

          let updatedChildren = n.children;
          if (updatedChildren) {
            updatedChildren = updatedChildren.map(child => {
              if (child.kind === "row" && child.page) {
                const page = child.page;
                let newTitle = "";
                if (previewColumns && previewColumns.length > 0) {
                  newTitle = previewColumns
                    .map(col => propertyValue(page.properties?.[col], { showIdForRelationRollup: showRelationIds }))
                    .filter(Boolean)
                    .join(" · ");
                } else {
                  newTitle = firstTitleProperty(page);
                }
                return { ...child, title: newTitle || "Untitled" };
              }
              return child;
            });
          }

          return {
            ...n,
            selectedColumns,
            columnDetails: updatedColumnDetails,
            previewColumns,
            previewColumn: previewColumns?.[0], // Keep for fallback compatibility
            children: updatedChildren
          };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    };

    const updatedNodes = updateNode(nodes);
    setNodes(updatedNodes);

    // Also update cache so it persists across depth changes
    for (const root of updatedNodes) {
      const matchedDetected = detectedList.find(d => d.id === root.id);
      if (matchedDetected) {
        const cacheKey = treeCacheKey(matchedDetected.id, depth, matchedDetected.viewId);
        if (treeCache.current.has(cacheKey)) {
          treeCache.current.set(cacheKey, root);
        }
      }
    }
  }

  async function runExport() {
    if (tokens.length === 0 || !selectedNodes.length) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting(true);
    setError("");

    // Use a granular scale where each selected node is 100 units
    const UNITS_PER_NODE = 100;
    setExportTotal(selectedNodes.length * UNITS_PER_NODE);
    setExportCurrent(0);
    setExportStatus("Initializing...");

    try {
      const items: ExportItem[] = [];
      let baseProgress = 0;

      for (const node of selectedNodes) {
        setExportStatus(`Fetching ${node.title}...`);

        if (node.error) {
          baseProgress += UNITS_PER_NODE;
          setExportCurrent(baseProgress);
          continue;
        }

        if (node.kind === "database" || node.kind === "data_source") {
          let exportRows: NotionPage[] = [];
          if (node.children && node.children.length > 0) {
            exportRows = node.children
              .filter((c) => selected.has(c.id) && c.page)
              .map((c) => c.page!);
          }

          items.push({
            kind: node.kind,
            id: node.id,
            title: node.title,
            rows: exportRows,
            columns: node.columns,
            selectedColumns: node.selectedColumns,
            columnDetails: node.columnDetails,
            viewId: node.viewId,
            viewTitle: node.views?.find((view) => view.id === node.viewId)?.title,
            properties: node.properties,
            depth: node.depth
          });
        } else {
          // Page/Row/Block fetching
          // No hard jump to 50%, let the smooth UI logic handle the perceived progress

          let blocks: NotionBlock[] = [];
          let comments: any[] = [];
          if (shouldFetchPageContent(node, depth)) {
            try {
              const nodeToken = node.token || activeToken?.token || "";
              
              // Helper to reconstruct blocks from tree cache
              const buildBlocksFromTree = (n: TreeNodeData): NotionBlock[] => {
                if (!n.children || n.children.length === 0) return [];
                const res: NotionBlock[] = [];
                for (const child of n.children) {
                  if (child.block) {
                    const b = { ...child.block };
                    b.children = buildBlocksFromTree(child);
                    res.push(b);
                  }
                }
                return res;
              };

              let fetchedFromApi = false;
              if (node.children && node.children.some(c => c.block)) {
                // We have cached blocks in the tree!
                blocks = buildBlocksFromTree(node);
              } else {
                fetchedFromApi = true;
                const body = await memoFetch(contentCache.current, `${nodeToken}:content:${node.id}:${depth}:${fetchComments}`, () =>
                  apiFetch<{ results: NotionBlock[]; comments?: any[] }>(nodeToken, `/api/notion/page/${node.id}/content?depth=${depth}&comments=${fetchComments}`, { signal: controller.signal, onStatus: setExportStatus })
                );
                blocks = body.results;
              }

              // If blocks contain child_database, fetch their content too for proper nesting
              for (const block of blocks as any[]) {
                if (block.type === "child_database") {
                  const isAlreadySelected = selectedNodes.some(n => n.id === block.id);
                  if (isAlreadySelected) continue;

                  const dbTreeNode = flatNodes.find((n) => n.id === block.id);
                  if (dbTreeNode) {
                    let exportDbRows: NotionPage[] = [];
                    if (dbTreeNode.children && dbTreeNode.children.length > 0) {
                      exportDbRows = dbTreeNode.children
                        .filter((c) => selected.has(c.id) && c.page)
                        .map((c) => c.page!);
                    }
                    items.push({
                      kind: "database",
                      id: block.id,
                      title: dbTreeNode.title ?? block.child_database?.title ?? "Untitled database",
                      rows: exportDbRows,
                      columns: dbTreeNode.columns,
                      columnDetails: dbTreeNode.columnDetails,
                      viewId: dbTreeNode.viewId,
                      viewTitle: dbTreeNode.views?.find((view) => view.id === dbTreeNode.viewId)?.title,
                      properties: dbTreeNode.properties,
                      depth: (node.depth ?? 0) + 1
                    });
                  } else {
                    items.push({
                      kind: "database",
                      id: block.id,
                      title: block.child_database?.title ?? "Untitled database",
                      rows: [],
                      depth: (node.depth ?? 0) + 1
                    });
                  }
                }
              }

              // Filter blocks based on selection if blocks are shown in tree
              if (node.children && node.children.length > 0) {
                const selectedInTree = new Set(node.children.filter(c => selected.has(c.id)).map(c => c.id));
                // Only filter if some children are NOT selected (to avoid unexpected empty export if nothing selected in sub-tree)
                if (selectedInTree.size < node.children.length) {
                  blocks = blocks.filter(b => selectedInTree.has(b.id));
                }
              }
            } catch {
              blocks = [];
            }
          }

          const rowAlreadyInSelectedTable = node.kind === "row" && node.parentId && selected.has(node.parentId);
          // Only skip a row if: it is already rendered as a table row by the parent database
          // AND it has no block content AND the user hasn't explicitly selected any child blocks inside it.
          const hasSelectedChildren = node.children?.some(c => selected.has(c.id)) ?? false;
          if (rowAlreadyInSelectedTable && !blocks.length && !hasSelectedChildren) {
            // Skip — pure leaf row, rendered only in the parent table
          } else {
            items.push({ id: node.id, kind: node.kind, title: node.title, page: node.page, blocks, comments, includeProperties: !rowAlreadyInSelectedTable, depth: node.depth });
          }
        }

        baseProgress += UNITS_PER_NODE;
        setExportCurrent(baseProgress);
      }

      setExportStatus("Generating export mapping...");
      const titleById = await buildExportTitleMap(tokens, items, flatNodes, titleCache.current, { signal: controller.signal, onStatus: setExportStatus });

      setExportStatus("Ready!");
      setTitleMap(titleById);
      setExportItems(items);

      // Ensure we hit the 100% mark in state before closing
      setExportCurrent(selectedNodes.length * UNITS_PER_NODE);

    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err));
    } finally {
      // Keep open just long enough for the satisfaction animation to complete
      const delay = controller.signal.aborted ? 0 : 800;
      setTimeout(() => setExporting(false), delay);
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
    }
  }

  function cancelExport() {
    exportAbortRef.current?.abort();
    setExportStatus("Cancelled.");
    setExporting(false);
  }

  function cancelFetch() {
    treeAbortRef.current?.abort();
    setLoadingTree(false);
  }

  function clearWork() {
    treeAbortRef.current?.abort();
    exportAbortRef.current?.abort();
    setUrls([""]);
    setActiveInputIndex(0);
    setDetectedList([]);
    setNodes([]);
    setSelected(new Set());
    setExportItems([]);
    setError("");
    setLoadingTree(false);
    setExporting(false);
  }

  // Auto reset if all inputs empty
  useEffect(() => {
    const hasAnyUrl = urls.some(u => u.trim());
    if (!hasAnyUrl && detectedList.length > 0) {
      treeAbortRef.current?.abort();
      exportAbortRef.current?.abort();
      setDetectedList([]);
      setNodes([]);
      setSelected(new Set());
      setExportItems([]);
      setError("");
      setLoadingTree(false);
      setExporting(false);
    }
  }, [urls, detectedList.length]);

  if (!sessionLoaded) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-500">Loading session...</div>;
  }

  if (!username) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const name = fd.get("username") as string;
          if (name.trim()) {
            localStorage.setItem("notionpull_username", name.trim());
            window.location.reload();
          }
        }} className="bg-white p-8 rounded-xl shadow-sm border border-zinc-200 max-w-sm w-full">
          <div className="flex items-center gap-3 mb-6">
            <Image src="/favicon.png" alt="Notionpull" width={32} height={32} className="rounded-lg" />
            <h2 className="text-xl font-semibold">Notionpull</h2>
          </div>
          <p className="text-zinc-500 mb-6 text-sm">Enter a username to start your persistent session. Your work will be saved automatically.</p>
          <input name="username" autoFocus placeholder="Username" className="w-full px-3 py-2 border border-zinc-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-zinc-900" />
          <button type="submit" className="w-full bg-zinc-900 text-white py-2 rounded-lg font-medium">Continue</button>
        </form>
      </div>
    );
  }

  return (
    <main className="min-h-screen pb-24 bg-zinc-50">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="cursor-pointer select-none flex items-center gap-2.5" onClick={clearWork} title="Start over">
            <Image src="/favicon.png" alt="Notionpull logo" width={28} height={28} className="rounded-md" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Notionpull</h1>
              <p className="text-xs font-medium text-zinc-500">
                {tokens.length > 0
                  ? tokens.map(t => t.workspaceName || t.label).join(", ")
                  : "No active workspace"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={resetLog}
                  onChange={(e) => handleResetLogChange(e.target.checked)}
                />
                <div className={`w-8 h-4 rounded-full transition-colors duration-200 ease-in-out ${resetLog ? "bg-zinc-900" : "bg-zinc-200"}`} />
                <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full shadow transition-transform duration-200 ease-in-out ${resetLog ? "translate-x-4" : "translate-x-0"}`} />
              </div>
              <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 transition-colors">Reset Log on Fetch</span>
            </label>

            <button
              onClick={() => {
                if (confirm("Are you sure you want to log out and reset your session? All your cached tree data will be deleted.")) {
                  fetch(`/api/session?username=${encodeURIComponent(username)}`, { method: "DELETE" })
                    .then(() => {
                      localStorage.removeItem("notionpull_username");
                      window.location.reload();
                    })
                    .catch(() => {
                      // Fallback just in case server is unreachable
                      localStorage.removeItem("notionpull_username");
                      window.location.reload();
                    });
                }
              }}
              className="text-sm font-medium text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Reset Session
            </button>

            <div className="flex gap-2">
              <button className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 transition" onClick={() => setDebugOpen(true)}>
                Debug
              </button>
              <button className="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 transition" onClick={() => setManagerOpen(true)}>
                Tokens
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-6 py-8">
        {tokens.length === 0 ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="max-w-md rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 mb-4">
                <LogOut className="h-6 w-6 text-zinc-600" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-900">Add Notion token</h2>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed">Save your workspace integration token to start fetching and exporting content.</p>
              <button className="mt-6 w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 transition" onClick={() => setManagerOpen(true)}>
                Manage Tokens
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <form className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" onSubmit={submitUrl}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3 sticky top-[4rem] bg-white z-20 pt-2 pb-3 -mx-5 px-5 border-b border-zinc-100">
                <div className="flex flex-wrap items-center gap-2 min-w-0 flex-auto">
                  <label className="block text-sm font-medium text-zinc-900">Paste Notion page or database URLs</label>
                  {relativeTime && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                      Fetched {relativeTime}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-4 ml-auto min-w-0 flex-auto">
                  {/* Before Fetch Settings */}
                  <div className="flex flex-wrap items-center gap-4 bg-zinc-50 border border-zinc-200/80 rounded-xl px-3.5 py-1.5 shadow-sm">


                    <div className="flex items-center gap-2" title="Hover button & scroll or use Up/Down arrows to adjust max children">
                      <span className="text-xs font-semibold text-zinc-500">Depth</span>
                      <div ref={setDepthContainer} className="flex rounded-md border border-zinc-300 bg-white p-0.5 shadow-sm select-none">
                        {depthOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            data-depth-option={option}
                            onMouseEnter={() => setHoveredDepth(option)}
                            onMouseLeave={() => setHoveredDepth(null)}
                            className={`relative rounded px-2 py-0.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-50 ${depth === option ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:bg-zinc-100"}`}
                            onClick={() => {
                              if (option !== depth) {
                                handleDepthChange(option);
                              }
                            }}
                            disabled={loadingTree}
                          >
                            <span>{option}</span>
                            <span className={`ml-1 text-[9px] font-mono font-medium ${depth === option ? "text-zinc-300" : "text-zinc-400"}`}>
                              ({maxChildrenMap[option] === 0 ? "max" : String(maxChildrenMap[option]).padStart(3, "0")})
                            </span>
                            {hoveredDepth === option && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-zinc-950 text-white text-[10px] py-1.5 px-2.5 rounded-md shadow-lg pointer-events-none whitespace-nowrap flex flex-col items-center border border-zinc-800 leading-tight">
                                <span className="font-bold font-mono">limit: {maxChildrenMap[option] === 0 ? "max" : String(maxChildrenMap[option]).padStart(3, "0")}</span>
                                <span className="text-[8px] text-zinc-400 mt-0.5">Scroll / Arrow Up/Down to adjust</span>
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="hidden sm:block h-4 w-px bg-zinc-200" />

                    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={fetchLinkedChildren}
                          onChange={(e) => handleFetchLinkedChildrenChange(e.target.checked)}
                          disabled={loadingTree}
                        />
                        <div className={`w-9 h-5 rounded-full transition-colors duration-200 ease-in-out ${fetchLinkedChildren ? "bg-zinc-900" : "bg-zinc-200"}`} />
                        <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ease-in-out ${fetchLinkedChildren ? "translate-x-4" : "translate-x-0"}`} />
                      </div>
                      <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 transition-colors">Cell Links</span>
                    </label>

                    <div className="hidden sm:block h-4 w-px bg-zinc-200" />

                    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={fetchDatabaseRelations}
                          onChange={(e) => handleFetchDatabaseRelationsChange(e.target.checked)}
                          disabled={loadingTree}
                        />
                        <div className={`w-9 h-5 rounded-full transition-colors duration-200 ease-in-out ${fetchDatabaseRelations ? "bg-zinc-900" : "bg-zinc-200"}`} />
                        <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ease-in-out ${fetchDatabaseRelations ? "translate-x-4" : "translate-x-0"}`} />
                      </div>
                      <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 transition-colors">DB Relations</span>
                    </label>

                    <div className="hidden sm:block h-4 w-px bg-zinc-200" />

                    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={fetchComments}
                          onChange={(e) => handleFetchCommentsChange(e.target.checked)}
                          disabled={loadingTree}
                        />
                        <div className={`w-9 h-5 rounded-full transition-colors duration-200 ease-in-out ${fetchComments ? "bg-zinc-900" : "bg-zinc-200"}`} />
                        <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ease-in-out ${fetchComments ? "translate-x-4" : "translate-x-0"}`} />
                      </div>
                      <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 transition-colors">Fetch Comments</span>
                    </label>
                  </div>

                  {/* After Fetch Settings */}
                  {detected && (
                    <div className="flex flex-wrap items-center gap-4 bg-zinc-50 border border-zinc-200/80 rounded-xl px-3.5 py-1.5 shadow-sm">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                        <div className="relative">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={showRelationIds}
                            onChange={(e) => handleShowRelationIdsChange(e.target.checked)}
                          />
                          <div className={`w-9 h-5 rounded-full transition-colors duration-200 ease-in-out ${showRelationIds ? "bg-zinc-900" : "bg-zinc-200"}`} />
                          <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform duration-200 ease-in-out ${showRelationIds ? "translate-x-4" : "translate-x-0"}`} />
                        </div>
                        <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-700 transition-colors">Relation IDs</span>
                      </label>
                      <div className="h-4 w-px bg-zinc-200" />
                      <button
                        type="button"
                        onClick={clearWork}
                        className="text-xs font-bold text-red-600 hover:text-red-800 transition active:scale-95"
                      >
                        Reset Session
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {error && (
                <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-700 shadow-sm">
                  {error}
                </div>
              )}
              <div className="flex flex-col lg:flex-row gap-6 items-start justify-between">
                {/* Left Side: Inputs */}
                <div className="flex-1 w-full space-y-3">
                  {urls.map((singleUrl, index) => {
                    const isDetecting = detectingUrls.has(singleUrl);
                    const urlIds = extractNotionIds(singleUrl);
                    const matchedDet = detectedList.find((d) => urlIds.includes(d.id));
                    const isDuplicate = singleUrl.trim() && urls.filter((u) => normalizeUrl(u) === normalizeUrl(singleUrl)).length > 1;
                    return (
                      <div key={index} className="flex gap-2 items-center">
                        <div className="relative flex-1 group">
                          {singleUrl && (
                            <div
                              className="url-highlight-overlay absolute inset-0 pl-3.5 pr-3 text-sm font-mono whitespace-nowrap overflow-hidden pointer-events-none select-none border border-transparent bg-transparent leading-[1.25rem] py-[calc(0.5rem+1px)]"
                              style={{
                                paddingRight: isDetecting ? "8rem" : matchedDet && isDuplicate ? "18rem" : matchedDet ? "14rem" : isDuplicate ? "6rem" : "0.75rem"
                              }}
                              dangerouslySetInnerHTML={{ __html: highlightNotionUrl(singleUrl) }}
                            />
                          )}
                          <input
                            className={`w-full rounded-md border pl-3.5 py-2 text-sm font-mono outline-none transition duration-150 caret-zinc-950 bg-transparent relative z-10 ${
                              singleUrl ? "text-transparent" : "text-zinc-900"
                            } ${
                              isDetecting ? "pr-32" : matchedDet && isDuplicate ? "pr-72" : matchedDet ? "pr-56" : isDuplicate ? "pr-24" : "pr-3"
                            } ${
                              isDuplicate
                                ? "border-amber-500 ring-2 ring-amber-500/10 focus:border-amber-600 focus:ring-amber-600/20"
                                : activeInputIndex === index
                                ? "border-zinc-950 ring-2 ring-zinc-950/10"
                                : "border-zinc-300 focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
                            }`}
                            value={singleUrl}
                            onChange={(event) => {
                              setUrls(prev => {
                                const next = [...prev];
                                next[index] = event.target.value;
                                return next;
                              });
                            }}
                            onScroll={handleUrlScroll}
                            onFocus={() => setActiveInputIndex(index)}
                            placeholder="Paste a Notion page or database URL..."
                          />
                          {isDetecting ? (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none select-none flex items-center gap-1.5 text-xs text-zinc-400">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Detecting...</span>
                            </div>
                          ) : (matchedDet || isDuplicate) && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none select-none flex items-center gap-1.5 text-xs text-zinc-400">
                              {isDuplicate && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 animate-pulse">
                                  Duplicate
                                </span>
                              )}
                              {matchedDet && (
                                <>
                                  <span className="truncate max-w-[120px] font-medium" title={matchedDet.title}>
                                    {matchedDet.title}
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded bg-zinc-100/80 border border-zinc-200/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    {matchedDet.type === "page" ? (
                                      <FileText className="h-3 w-3 text-zinc-400" />
                                    ) : matchedDet.type === "database" ? (
                                      <Database className="h-3 w-3 text-zinc-400" />
                                    ) : (
                                      <Table2 className="h-3 w-3 text-zinc-400" />
                                    )}
                                    {matchedDet.type.replace("_", " ")}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {(urls.length > 1 || singleUrl) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (urls.length > 1) {
                                setUrls(prev => {
                                  const next = prev.filter((_, i) => i !== index);
                                  if (activeInputIndex >= next.length) {
                                    setActiveInputIndex(Math.max(0, next.length - 1));
                                  }
                                  return next;
                                });
                              } else {
                                setUrls([""]);
                              }
                            }}
                            className="rounded-md border border-zinc-300 bg-white p-2 text-zinc-500 hover:bg-red-50 hover:text-red-500 transition shadow-sm shrink-0"
                            title={urls.length > 1 ? "Remove link" : "Clear URL"}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {singleUrl.trim() && (() => {
                          const ids = extractNotionIds(singleUrl);
                          const matchedDet = detectedList.find(d => ids.includes(d.id));
                          const isFetched = !!(matchedDet && nodes.some(n => n.id === matchedDet.id));
                          return (
                            <button
                              type="button"
                              onClick={() => refetchUrl(index)}
                              disabled={loadingTree}
                              className="rounded-md border border-zinc-900 bg-zinc-900 p-2 text-white hover:bg-zinc-800 active:scale-95 transition shadow-sm shrink-0 disabled:bg-zinc-400 disabled:border-zinc-400 disabled:scale-100"
                              title={isFetched ? "Refetch this URL" : "Fetch this URL"}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                          );
                        })()}
                      </div>
                    );
                  })}

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setUrls(prev => [...prev, ""]);
                        setActiveInputIndex(urls.length);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-95"
                    >
                      + Add another URL
                    </button>

                    {urls.some(u => u.trim()) && !showSavePreset && (
                      <button
                        type="button"
                        onClick={() => setShowSavePreset(true)}
                        disabled={isCurrentInputSavedAsPreset}
                        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-95 disabled:bg-zinc-50 disabled:text-zinc-400 disabled:border-zinc-200 disabled:transform-none disabled:shadow-none disabled:cursor-not-allowed"
                        title={isCurrentInputSavedAsPreset ? "Preset already saved" : "Save current URLs as preset"}
                      >
                        <Bookmark className="h-3.5 w-3.5 text-zinc-400" />
                        Save as Preset
                      </button>
                    )}

                    {showSavePreset && (
                      <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1 shadow-sm">
                        <input
                          type="text"
                          placeholder="Preset name..."
                          value={newPresetName}
                          onChange={(e) => setNewPresetName(e.target.value)}
                          className="text-xs outline-none border-none bg-transparent w-32 font-medium text-zinc-800"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePreset(newPresetName);
                            if (e.key === "Escape") {
                              setShowSavePreset(false);
                              setNewPresetName("");
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => savePreset(newPresetName)}
                          className="text-xs font-bold text-zinc-900 hover:text-zinc-700 px-1"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowSavePreset(false);
                            setNewPresetName("");
                          }}
                          className="text-xs font-bold text-zinc-400 hover:text-zinc-600 px-1"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Action Buttons */}
                <div className="shrink-0 flex flex-col gap-3 items-stretch w-full lg:w-auto lg:sticky lg:top-[8.5rem]">
                  {loadingTree && (
                    <button
                      type="button"
                      onClick={cancelFetch}
                      className="flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-100"
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-2 rounded-md border border-transparent bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 disabled:bg-zinc-400 min-w-[100px]"
                    disabled={loadingTree || !urls.some(u => u.trim())}
                  >
                    {loadingTree ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Fetching...</span>
                      </>
                    ) : (
                      isRefetch ? "Refetch" : "Fetch"
                    )}
                  </button>
                  {detected && !loadingTree && flatNodes.length > 0 && (
                    <>
                      <button type="button" className="flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:opacity-50" onClick={deselectAll} disabled={!flatNodes.length}>Deselect All</button>
                      <button type="button" className="flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50" onClick={selectAll} disabled={!flatNodes.length}>Select All</button>
                    </>
                  )}
                  {tokens.length > 0 && detected && !loadingTree && nodes.length > 0 && (
                    <button
                      type="button"
                      className="flex items-center justify-center gap-2 rounded-md border border-transparent bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 hover:shadow-md disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                      onClick={runExport}
                      disabled={exporting || selected.size === 0}
                    >
                      {exporting ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin text-white" />
                          <span>Preparing...</span>
                        </>
                      ) : (
                        <span>Export ({selected.size})</span>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Presets List */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-3 relative">
                <Bookmark className="h-4 w-4 text-zinc-400" />
                <span className="text-xs text-zinc-500 font-semibold mr-1">Presets:</span>
                
                {presets.length > 0 ? (
                  presets.map((preset) => (
                    <div key={preset.id} className="group relative flex h-7 items-stretch rounded-md border border-zinc-200 bg-white shadow-sm overflow-hidden transition-colors hover:border-zinc-300">
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="inline-flex flex-1 items-center gap-1.5 bg-white px-2.5 text-xs text-zinc-600 transition hover:bg-zinc-50 border-r border-zinc-100"
                        title={preset.urls.join(", ")}
                      >
                        <span className="flex items-center justify-center text-zinc-400">
                          <Bookmark className="h-3.5 w-3.5 text-zinc-400" />
                        </span>
                        <span className="max-w-[150px] truncate font-semibold">{preset.name}</span>
                        <span className="text-[10px] text-zinc-400">({preset.urls.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removePreset(preset.id)}
                        className="inline-flex w-7 items-center justify-center bg-white text-zinc-400 transition hover:bg-red-50 hover:text-red-500"
                        title="Delete Preset"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-zinc-400 italic">No presets saved yet</span>
                )}

                <div className="ml-auto flex items-center gap-1.5 relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => document.getElementById("preset-import-input")?.click()}
                    className="inline-flex items-center gap-1 rounded bg-zinc-100 border border-zinc-200 px-2 py-0.5 text-[10px] font-bold text-zinc-600 transition hover:bg-zinc-200 active:scale-95 cursor-pointer"
                    title="Import presets from JSON"
                  >
                    <Upload className="h-3 w-3" />
                    Import
                  </button>
                  {presets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                      className="inline-flex items-center gap-1 rounded bg-zinc-100 border border-zinc-200 px-2 py-0.5 text-[10px] font-bold text-zinc-600 transition hover:bg-zinc-200 active:scale-95 cursor-pointer"
                      title="Export presets"
                    >
                      <Download className="h-3 w-3" />
                      Export
                    </button>
                  )}

                  {exportDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-lg z-50">
                      <button
                        type="button"
                        onClick={() => {
                          exportPresets();
                          setExportDropdownOpen(false);
                        }}
                        className="flex w-full items-center px-3 py-1.5 text-left text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                      >
                        Export All Presets
                      </button>
                      <div className="h-px bg-zinc-100 my-1" />
                      <div className="max-h-40 overflow-y-auto">
                        {presets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              exportSinglePreset(preset);
                              setExportDropdownOpen(false);
                            }}
                            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50 truncate"
                            title={`Export ${preset.name}`}
                          >
                            Export &quot;{preset.name}&quot;
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <input
                    id="preset-import-input"
                    type="file"
                    accept=".json"
                    onChange={importPresets}
                    className="hidden"
                  />
                </div>
              </div>

              {displayedHistory.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <History className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs text-zinc-500">Recent:</span>
                  {displayedHistory.map((item, i) => (
                    <div key={i} className="group relative flex h-7 items-stretch rounded-md border border-zinc-200 bg-white shadow-sm overflow-hidden transition-colors hover:border-zinc-300">
                      <button
                        type="button"
                        onClick={() => {
                          setUrls(prev => {
                            const next = [...prev];
                            if (activeInputIndex >= 0 && activeInputIndex < next.length) {
                              next[activeInputIndex] = item.url;
                            } else {
                              next[0] = item.url;
                            }
                            return next;
                          });
                        }}
                        className="inline-flex flex-1 items-center gap-1.5 bg-white px-2.5 text-xs text-zinc-600 transition hover:bg-zinc-50 border-r border-zinc-100"
                        title={item.url}
                      >
                        <span className="flex items-center justify-center text-zinc-400">
                          {item.type === 'page' ? <FileText className="h-3.5 w-3.5" /> : item.type === 'database' ? <Database className="h-3.5 w-3.5" /> : item.type === 'data_source' ? <Table2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                        </span>
                        <span className="max-w-[150px] truncate">{item.title || item.url}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUrlHistory(item.url)}
                        className="inline-flex w-7 items-center justify-center bg-white text-zinc-400 transition hover:bg-red-50 hover:text-red-500"
                        title="Remove from history"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}


            </form>



            {(detected || loadingTree) && (
              <FinderTree
                nodes={nodes}
                selected={selected}
                loading={loadingTree}
                onToggle={toggleNode}
                onConfigureDatabase={handleConfigureDatabase}
              />
            )}
          </div>
        )}
      </div>


      <TokenManager open={managerOpen} tokens={tokens} activeLabel={activeLabel} onClose={() => setManagerOpen(false)} onChange={refreshTokens} />

      <DatabaseConfigModal
        open={configOpen}
        token={configNode?.token || activeToken?.token}
        node={configNode}
        onClose={() => setConfigOpen(false)}
        onSave={saveDatabaseConfig}
        showIdForRelationRollup={showRelationIds}
        maxChildren={maxChildren}
      />

      <ExportProgress
        open={exporting}
        total={exportTotal}
        current={exportCurrent}
        status={exportStatus}
        onCancel={cancelExport}
      />

      <ExportModal
        open={exportItems.length > 0 && !exporting}
        items={exportItems}
        titleById={titleMap}
        onClose={() => setExportItems([])}
        showIdForRelationRollup={showRelationIds}
        onToggleShowIdForRelationRollup={handleShowRelationIdsChange}
      />

      <DebugModal open={debugOpen} onClose={() => setDebugOpen(false)} />
    </main>
  );
}

// Data Fetching logic (kept same except TreeNodeData modifications)

function treeCacheKey(id: string, depth: DepthOption, viewId?: string): string {
  return `${id}-${viewId ?? "default"}-${depth}`;
}

function depthValue(depth: DepthOption): number {
  if (depth === "Surface") return 0;
  return depth === "All" ? Infinity : Number(depth);
}

function getLimitForDepth(depthNum: number, maxChildrenMap: Record<DepthOption, number>): number {
  if (depthNum === 0) return maxChildrenMap["Surface"];
  if (depthNum === 1) return maxChildrenMap["1"];
  if (depthNum === 2) return maxChildrenMap["2"];
  if (depthNum === 3) return maxChildrenMap["3"];
  if (depthNum === 4) return maxChildrenMap["4"];
  if (depthNum === 5) return maxChildrenMap["5"];
  return maxChildrenMap["All"];
}

function getCachedTreeForDepth(cache: Map<string, TreeNodeData>, rootId: string, depth: DepthOption, viewId?: string): TreeNodeData | null {
  const exact = cache.get(treeCacheKey(rootId, depth, viewId));
  if (exact) return exact;

  const requestedDepth = depthValue(depth);
  for (const option of depthOptions) {
    if (depthValue(option) <= requestedDepth) continue;

    const deeperTree = cache.get(treeCacheKey(rootId, option, viewId));
    if (deeperTree) return cloneTreeToDepth(deeperTree, requestedDepth);
  }

  return null;
}

function cloneTreeToDepth(node: TreeNodeData, maxDepth: number): TreeNodeData {
  if (node.depth >= maxDepth || !node.children?.length) {
    return { ...node, children: undefined };
  }

  return {
    ...node,
children: node.children.map((child) => cloneTreeToDepth(child, maxDepth))
  };
}

type PageChildrenResponse = { results: Array<{ id: string; type: "page" | "database" | "block"; title: string; dataSourceName?: string }> };
type DatabaseResponse = { dataSourceId: string; dataSourceName?: string; title: string; viewId?: string; views?: Array<{ id: string; title?: string }>; columnDetails?: Array<{ id?: string; name: string; visible?: boolean; width?: number }>; columns?: string[]; selectedColumns?: string[]; description?: any[]; properties?: Record<string, any> };
type BuildMemo = {
  pageChildren: Map<string, Promise<PageChildrenResponse>>;
  databases: Map<string, Promise<DatabaseResponse>>;
  rows: Map<string, Promise<NotionPage[]>>;
  showIdForRelationRollup?: boolean;
  fetchLinkedChildren?: boolean;
  fetchDatabaseRelations?: boolean;
  fetchComments?: boolean;
  maxChildrenMap?: Record<DepthOption, number>;
  maxChildren?: number;
  onNodeUpdated?: (nodeId: string, updater: (node: TreeNodeData) => TreeNodeData) => void;
  signal?: AbortSignal;
};

async function buildNode(token: string, node: TreeNodeData, maxDepth: number, memo: BuildMemo): Promise<TreeNodeData> {
  node.token = token;
  node.status = "PENDING";
  memo.onNodeUpdated?.(node.id, () => ({ ...node }));
  try {
    if (node.kind === "page" || node.kind === "row" || node.kind === "block") {
      if ((!node.title || node.title === "Loading...") && (node.kind === "page" || node.kind === "row")) {
        try {
          const detected = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(node.id)}`, { signal: memo.signal });
          node.title = detected.title;
          const detectedType = detected.type === "database" ? "database" : (detected.type === "page" ? "page" : node.kind);
          node.kind = detectedType as any;
          if (detected.properties && !node.page) {
            node.page = { id: node.id, object: "page", properties: detected.properties } as any;
          }
        } catch {
          node.title = node.title || "Untitled";
        }
      }

      if (node.kind === "page" || node.kind === "row" || node.kind === "block") {
        if (node.depth >= maxDepth) {
          node.status = "DONE";
          memo.onNodeUpdated?.(node.id, () => ({ ...node }));
          return node;
        }

        if (!node.children) {
          node.children = [];
          memo.onNodeUpdated?.(node.id, () => ({ ...node }));

          let childNodes: TreeNodeData[] = [];
          if (node.depth < maxDepth) {
              const body = await memoPageChildren(token, node.id, memo);
              childNodes = body.results.map((child: any) => ({
                id: child.id,
                title: child.title,
                kind: child.type as any,
                depth: node.depth + 1,
                parentId: node.id,
                dataSourceName: child.dataSourceName,
                status: "PENDING",
                block: child
              }));
          }

          if ((node.kind === "row" || node.kind === "page") && node.page && memo.fetchLinkedChildren) {
            const relationIds = new Set<string>();
            for (const prop of Object.values(node.page.properties ?? {})) {
              if (prop && (prop as any).type === "relation" && Array.isArray((prop as any).relation)) {
                for (const rel of (prop as any).relation) {
                  if (rel.id && rel.id !== node.id) relationIds.add(rel.id);
                }
              }
              if (prop && ["rich_text", "title", "url"].includes((prop as any).type)) {
                const extracted = extractNotionIds(JSON.stringify(prop));
                for (const id of extracted) {
                  if (id !== node.id) relationIds.add(id);
                }
              }
            }

            const existingIds = new Set(childNodes.map(c => c.id));
            const newRelationNodes = Array.from(relationIds)
              .filter(id => !existingIds.has(id))
              .map(id => ({
                id,
                title: "Loading...",
                kind: "page" as const,
                depth: node.depth + 1,
                parentId: node.id,
                status: "PENDING" as const
              }));

            childNodes = [...childNodes, ...newRelationNodes];
          }

          node.children.push(...childNodes);
          memo.onNodeUpdated?.(node.id, () => ({ ...node }));
        }
        for (let i = 0; i < node.children.length; i++) {
          if (node.children[i].status === "PENDING") {
            node.children[i] = await buildNode(token, node.children[i], maxDepth, memo);
            memo.onNodeUpdated?.(node.id, () => ({ ...node }));
          }
        }
      }
    }
    if (node.kind === "database" || node.kind === "data_source") {
      const metadata = await resolveContainerMetadata(token, node, memo);
      node.kind = metadata.kind;
      node.viewId = node.viewId ?? metadata.viewId;
      node.dataSourceId = metadata.dataSourceId;
      node.dataSourceName = metadata.dataSourceName ?? node.dataSourceName;
      node.columns = metadata.columns ?? node.columns;
      node.selectedColumns = metadata.selectedColumns ?? node.selectedColumns;
      node.columnDetails = metadata.columnDetails ?? node.columnDetails;
      node.description = metadata.description ?? node.description;
      node.properties = metadata.properties ?? node.properties;
      node.isLinkedDatabase = metadata.isLinkedDatabase ?? node.isLinkedDatabase;
      const rowSourceKind = resolveRowSourceKind(node.id, node.dataSourceId, node.kind as "database" | "data_source");

      if (node.depth >= 30) {
        node.status = "DONE";
        memo.onNodeUpdated?.(node.id, () => ({ ...node }));
        return node;
      }

      if (!node.children) {
        node.children = [];
        
        if (memo.fetchDatabaseRelations && node.properties) {
          const relationDbIds = new Set<string>();
          for (const prop of Object.values(node.properties)) {
            if (prop.type === "relation" && prop.relation?.database_id) {
              relationDbIds.add(prop.relation.database_id);
            }
          }
          
          // Description links
          if (node.description) {
            const descLinks = extractNotionIds(JSON.stringify(node.description));
            for (const id of descLinks) {
              if (id !== node.id) relationDbIds.add(id);
            }
          }

          for (const id of relationDbIds) {
            node.children.push({
              id,
              title: "Loading linked database...",
              kind: "database",
              depth: node.depth + 1,
              parentId: node.id,
              isLinkedDatabase: true,
              status: "PENDING"
            });
          }
        }
        memo.onNodeUpdated?.(node.id, () => ({ ...node }));

        if (node.depth + 1 <= maxDepth) {
          const previewColumns = node.previewColumns && node.previewColumns.length > 0
            ? node.previewColumns
            : (node.selectedColumns && node.selectedColumns.length > 0
              ? node.selectedColumns
              : node.columnDetails?.filter((col) => col.visible !== false).map((col) => col.name));

          const cacheKey = `${token}:rows:${node.id}:${node.dataSourceId ?? node.id}:${rowSourceKind}:${node.viewId ?? ""}`;
          if (memo.rows.has(cacheKey)) {
            const rows = await memo.rows.get(cacheKey)!;
            const newRowNodes = rows.map((row) => ({
              id: row.id,
              title: rowDisplayTitle(row, previewColumns, memo.showIdForRelationRollup) || "Untitled",
              kind: "row" as const,
              depth: node.depth + 1,
              parentId: node.id,
              page: row,
              status: "PENDING" as const
            }));
            node.children.push(...newRowNodes);
            memo.onNodeUpdated?.(node.id, () => ({ ...node }));
          } else {
            await memoRows(token, node.dataSourceId ?? node.id, rowSourceKind, node.viewId, memo, node.id, node.depth + 1, async (pageRows) => {
              const newRowNodes = pageRows.map((row) => ({
                id: row.id,
                title: rowDisplayTitle(row, previewColumns, memo.showIdForRelationRollup) || "Untitled",
                kind: "row" as const,
                depth: node.depth + 1,
                parentId: node.id,
                page: row,
                status: "PENDING" as const
              }));
              node.children!.push(...newRowNodes);
              memo.onNodeUpdated?.(node.id, () => ({ ...node }));
              
              for (const child of newRowNodes) {
                const idx = node.children!.findIndex(c => c.id === child.id);
                if (idx !== -1) {
                  node.children![idx] = await buildNode(token, child, maxDepth, memo);
                  memo.onNodeUpdated?.(node.id, () => ({ ...node }));
                }
              }
            });
          }
        }
      }

      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          if (node.children[i].status === "PENDING") {
            if (node.children[i].depth > 30) {
              node.children[i].status = "DONE";
              memo.onNodeUpdated?.(node.id, () => ({ ...node }));
            } else {
              node.children[i] = await buildNode(token, node.children[i], maxDepth, memo);
              memo.onNodeUpdated?.(node.id, () => ({ ...node }));
            }
          }
        }
      }
    }
    node.status = "DONE";
    memo.onNodeUpdated?.(node.id, () => ({ ...node }));
  } catch (err) {
    node.error = errorMessage(err);
    node.status = "ERROR";
    memo.onNodeUpdated?.(node.id, () => ({ ...node }));
  }
  return node;
}



async function resolveContainerMetadata(token: string, node: TreeNodeData, memo: BuildMemo): Promise<Pick<TreeNodeData, "kind" | "dataSourceId" | "dataSourceName" | "columns" | "properties" | "views" | "viewId" | "selectedColumns" | "columnDetails" | "isLinkedDatabase" | "description">> {
  if (node.dataSourceId && node.columns && node.properties) {
    return {
      kind: node.kind === "data_source" ? "data_source" : "database",
      dataSourceId: node.dataSourceId,
      dataSourceName: node.dataSourceName,
      columns: node.columns,
      views: node.views,
      columnDetails: node.columnDetails,
      description: node.description,
      properties: node.properties,
      viewId: node.viewId,
      selectedColumns: node.selectedColumns,
      isLinkedDatabase: node.isLinkedDatabase
    };
  }

  try {
    const metadata = await memoDatabase(token, node.id, node.kind === "data_source" ? "data_source" : "database", node.viewId, memo);
    return {
      kind: node.kind === "data_source" ? "data_source" : "database",
      dataSourceId: metadata.dataSourceId,
      dataSourceName: metadata.dataSourceName ?? node.dataSourceName,
      columns: metadata.columns,
      selectedColumns: metadata.selectedColumns,
      views: metadata.views ?? node.views,
      columnDetails: metadata.columnDetails ?? node.columnDetails,
      description: (metadata as any).description ?? node.description,
      properties: metadata.properties,
      viewId: metadata.viewId,
      isLinkedDatabase: (metadata as any).isLinkedDatabase ?? node.isLinkedDatabase,
    };
  } catch {
    const viewQuery = node.viewId ? `&viewId=${encodeURIComponent(node.viewId)}` : "";
    const detected = await apiFetch<DetectedObject>(token, `/api/notion/detect?id=${encodeURIComponent(node.id)}${viewQuery}`, { signal: memo.signal });
    return {
      kind: detected.type === "data_source" ? "data_source" : "database",
      dataSourceId: detected.dataSourceId ?? node.id,
      dataSourceName: detected.dataSourceName ?? node.dataSourceName,
      columns: detected.columns ?? node.columns,
      selectedColumns: detected.selectedColumns ?? node.selectedColumns,
      views: detected.views ?? node.views,
      columnDetails: detected.columnDetails ?? node.columnDetails,
      description: detected.description ?? node.description,
      properties: detected.properties ?? node.properties,
      viewId: detected.viewId ?? node.viewId,
      isLinkedDatabase: detected.isLinkedDatabase ?? node.isLinkedDatabase,
    };
  }
}

function memoPageChildren(token: string, pageId: string, memo: BuildMemo): Promise<PageChildrenResponse> {
  const commentsQuery = memo.fetchComments ? `?comments=true` : "";
  return memoFetch(memo.pageChildren, `${token}:page:${pageId}:${memo.fetchComments ?? false}`, () => (
    apiFetch<PageChildrenResponse>(token, `/api/notion/page/${pageId}/children${commentsQuery}`, { signal: memo.signal })
  ));
}

function memoDatabase(token: string, databaseId: string, kind: "database" | "data_source", viewId: string | undefined, memo: BuildMemo): Promise<DatabaseResponse> {
  const viewQuery = viewId ? `&viewId=${encodeURIComponent(viewId)}` : "";
  return memoFetch(memo.databases, `${token}:database:${databaseId}:${kind}:${viewId ?? ""}`, () => (
    apiFetch<DatabaseResponse>(token, `/api/notion/database/${databaseId}?kind=${encodeURIComponent(kind)}${viewQuery}`, { signal: memo.signal })
  ));
}

function memoRows(token: string, dataSourceId: string, kind: "database" | "data_source", viewId: string | undefined, memo: BuildMemo, containerId?: string, depth?: number, onPageFetched?: (rows: NotionPage[]) => Promise<void>): Promise<NotionPage[]> {
  const limit = (depth !== undefined && memo.maxChildrenMap) ? getLimitForDepth(depth, memo.maxChildrenMap) : memo.maxChildren;
  return memoFetch(memo.rows, `${token}:rows:${containerId ?? dataSourceId}:${dataSourceId}:${kind}:${viewId ?? ""}`, () => fetchAllRows(token, dataSourceId, kind, viewId, undefined, { signal: memo.signal }, limit, onPageFetched));
}

function memoFetch<T>(cache: Map<string, Promise<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;

  const request = fetcher().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, request);
  return request;
}

function resolveRowSourceKind(containerId: string, dataSourceId: string | undefined, kind: "database" | "data_source"): "database" | "data_source" {
  if (dataSourceId && dataSourceId !== containerId) return "data_source";
  return kind === "data_source" ? "data_source" : "database";
}

function rowDisplayTitle(row: NotionPage, preferredColumns?: string[], showIdForRelationRollup?: boolean): string {
  const preferredParts = (preferredColumns ?? [])
    .map((column) => propertyValue(row.properties?.[column], { showIdForRelationRollup }))
    .filter(Boolean);

  if (preferredParts.length > 0) return preferredParts.join(" · ");

  const title = firstTitleProperty(row);
  if (title && title !== "Untitled page") return title;

  const fallback = Object.values(row.properties ?? {})
    .map((prop) => propertyValue(prop, { showIdForRelationRollup }))
    .find(Boolean);

  return fallback || "Untitled";
}

type ApiFetchOptions = {
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
};

let notionClientQueue: Promise<void> = Promise.resolve();
let notionClientBlockedUntil = 0;
const NOTION_MIN_REQUEST_SPACING_MS = 375;

async function fetchAllRows(token: string, dataSourceId: string, kind: "database" | "data_source", viewId?: string, onProgress?: (count: number) => void, options: ApiFetchOptions = {}, maxChildren?: number, onPageFetched?: (rows: NotionPage[]) => Promise<void>): Promise<NotionPage[]> {
  const rows: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ kind });
    if (cursor) qs.set("cursor", cursor);
    if (viewId) qs.set("viewId", viewId);
    if (maxChildren !== undefined && maxChildren > 0) {
      qs.set("page_size", String(Math.min(maxChildren - rows.length, 100)));
    }
    const body = await apiFetch<RowsResponse>(token, `/api/notion/datasource/${dataSourceId}/rows?${qs.toString()}`, options);
    rows.push(...body.results);
    
    if (onPageFetched) {
      await onPageFetched(body.results);
    }
    
    cursor = body.has_more ? body.next_cursor : null;
    if (onProgress) onProgress(rows.length);
    if (maxChildren !== undefined && maxChildren > 0 && rows.length >= maxChildren) {
      rows.length = maxChildren;
      break;
    }
  } while (cursor);
  return rows;
}

async function apiFetch<T>(token: string, url: string, options: ApiFetchOptions = {}, attempt = 0): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-notion-token": token }, signal: options.signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error("Could not reach Notion — check your connection");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt < 5) {
    const retryMs = retryAfterMs(response.headers.get("retry-after"), attempt);
    notionClientBlockedUntil = Math.max(notionClientBlockedUntil, Date.now() + retryMs);
    options.onStatus?.(`Notion rate limit hit. Pausing ${formatWait(retryMs)} before retry ${attempt + 1}/5.`);
    await sleep(retryMs, options.signal);
    return apiFetch<T>(token, url, options, attempt + 1);
  }
  if (!response.ok) throw new Error(mapHttpError(response.status, body.error));
  return body as T;
}

async function waitForNotionTurn(options: ApiFetchOptions) {
  const previous = notionClientQueue;
  let release!: () => void;
  notionClientQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(NOTION_MIN_REQUEST_SPACING_MS, notionClientBlockedUntil - Date.now());
    if (waitMs > 0) {
      if (waitMs > NOTION_MIN_REQUEST_SPACING_MS) {
        options.onStatus?.(`Notion is cooling down. Next request in ${formatWait(waitMs)}.`);
      }
      await sleep(waitMs, options.signal);
    }
  } finally {
    release();
  }
}

function retryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.max(1000, dateMs - Date.now());
  }
  return Math.min(30000, 2000 * 2 ** attempt);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(abortError());
    }, { once: true });
  });
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

function abortError() {
  return new DOMException("Cancelled", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function mapHttpError(status: number, detail?: string): string {
  if (status === 401) return "Token invalid or expired — check your Notion token";
  if (status === 404) return "Not found — make sure the integration has access to this page (Share → Invite integration)";
  if (status === 429) return "Notion rate limit is still active. Try again after the current cooldown finishes.";
  return detail ?? "Unexpected error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function shouldFetchPageContent(node: TreeNodeData, currentDepth: DepthOption): boolean {
  if (currentDepth === "Surface") return false;
  if (node.kind === "row") {
    if (currentDepth === "All") return true;
    return Number(currentDepth) > node.depth;
  }
  return true;
}

async function buildExportTitleMap(tokens: NotionTokenEntry[], items: ExportItem[], nodes: TreeNodeData[], cache: Map<string, string>, options: ApiFetchOptions = {}): Promise<Map<string, string>> {
  const titleById = new Map(cache);
  for (const node of nodes) setKnownTitle(titleById, cache, node.id, node.title);
  for (const item of items) {
    if (isDatabaseExportItem(item)) {
      for (const row of item.rows) {
        setKnownTitle(titleById, cache, row.id, firstTitleProperty(row));
        collectPropertyObjectIds(row.properties, titleById);
      }
    } else if (item.page) {
      setKnownTitle(titleById, cache, item.page.id, firstTitleProperty(item.page));
      collectPropertyObjectIds(item.page.properties, titleById);
    }
  }

  const missingIds = Array.from(titleById.entries()).filter(([, title]) => !title).map(([id]) => id);
  let resolved = 0;
  await Promise.all(
    missingIds.map(async (id) => {
      try {
        let object: DetectedObject | null = null;
        for (const t of tokens) {
          try {
            object = await apiFetch<DetectedObject>(t.token, `/api/notion/detect?id=${encodeURIComponent(id)}`, options);
            if (object) break;
          } catch (err) {
            if (isAbortError(err)) throw err;
          }
        }
        if (object) {
          titleById.set(id, object.title);
          cache.set(id, object.title);
        } else {
          titleById.set(id, "");
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        titleById.set(id, "");
      }
      resolved += 1;
      options.onStatus?.(`Resolving linked titles ${resolved}/${missingIds.length}...`);
    })
  );
  return titleById;
}

function setKnownTitle(titleById: Map<string, string>, cache: Map<string, string>, id: string, title: string) {
  if (!title) return;
  titleById.set(id, title);
  cache.set(id, title);
}

function collectPropertyObjectIds(properties: Record<string, any> | undefined, titleById: Map<string, string>) {
  for (const prop of Object.values(properties ?? {})) collectObjectIds(prop, titleById);
}

function collectObjectIds(value: any, titleById: Map<string, string>) {
  if (!value || typeof value !== "object") return;
  if (value.type === "relation") {
    for (const relation of value.relation ?? []) {
      if (!relation.id) continue;
      if (relation.title) {
        titleById.set(relation.id, relation.title);
      } else if (!titleById.has(relation.id)) {
        titleById.set(relation.id, "");
      }
    }
  }
  if (value.type === "url") {
    for (const id of extractNotionIds(value.url ?? "")) {
      if (!titleById.has(id)) titleById.set(id, "");
    }
  }
  if (value.type === "rollup" && value.rollup?.type === "array") {
    for (const item of value.rollup.array ?? []) collectObjectIds(item, titleById);
  }
  if (value.type === "formula" && value.formula?.type === "string") {
    for (const id of extractNotionIds(value.formula.string ?? "")) {
      if (!titleById.has(id)) titleById.set(id, "");
    }
  }
}

function isDatabaseExportItem(item: ExportItem): item is Extract<ExportItem, { rows: NotionPage[] }> {
  return item.kind === "database" || item.kind === "data_source";
}
