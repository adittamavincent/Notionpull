import { useEffect, useState } from "react";
import { X, Activity, RefreshCw, Trash2, ChevronRight, ChevronDown, TerminalSquare } from "lucide-react";
import type { LogEntry } from "@/lib/logger";

export function DebugModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notion/debug?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      await fetch("/api/notion/debug", { method: "DELETE" });
      setLogs([]);
      setExpandedId(null);
    } catch (err) {
      console.error("Failed to clear logs", err);
    }
  };

  useEffect(() => {
    if (open) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative flex h-full max-h-[85vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-zinc-200">
              <Activity className="h-5 w-5 text-zinc-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">API Raw Tracking</h2>
              <p className="text-xs text-zinc-500">Live feed of Notion API requests and responses</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchLogs}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button 
              onClick={clearLogs}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </button>
            <div className="h-6 w-px bg-zinc-200 mx-1"></div>
            <button onClick={onClose} className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-zinc-50/30 p-6">
          {logs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <TerminalSquare className="h-12 w-12 text-zinc-300 mb-4" />
              <h3 className="text-sm font-medium text-zinc-900">No logs yet</h3>
              <p className="mt-1 text-xs text-zinc-500 max-w-sm">
                Perform an action like fetching a URL or exporting to see the raw API calls appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                const isError = log.status >= 400;
                
                return (
                  <div key={log.id} className={`overflow-hidden rounded-lg border bg-white shadow-sm transition-all ${isError ? 'border-red-200 ring-1 ring-red-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                    <button 
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zinc-50"
                    >
                      <div className="flex items-center gap-4 overflow-hidden">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />}
                        
                        <div className={`flex w-16 shrink-0 justify-center rounded px-2 py-0.5 text-xs font-bold tracking-wider ${
                          log.method === 'GET' ? 'bg-blue-50 text-blue-700' :
                          log.method === 'POST' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'
                        }`}>
                          {log.method}
                        </div>
                        
                        <div className={`flex w-12 shrink-0 justify-center rounded px-2 py-0.5 text-xs font-bold ${
                          isError ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-700'
                        }`}>
                          {log.status}
                        </div>
                        
                        <div className="flex items-center gap-2 truncate">
                          {log.nameTag && (
                            <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold max-w-[200px] truncate border shadow-sm ${
                              log.objectType === 'database' 
                                ? 'bg-blue-50 text-blue-700 border-blue-200/50' 
                                : log.objectType === 'data_source' 
                                ? 'bg-purple-50 text-purple-700 border-purple-200/50' 
                                : log.objectType === 'page'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                                : log.objectType === 'list'
                                ? 'bg-zinc-100 text-zinc-700 border-zinc-200'
                                : 'bg-zinc-800 text-white border-zinc-900'
                            }`}>
                              {log.nameTag}
                            </span>
                          )}
                          <div className="truncate text-sm font-medium text-zinc-700" title={log.url}>
                            {log.url.replace('https://api.notion.com/v1', '')}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex shrink-0 items-center gap-4 text-xs text-zinc-500">
                        <span className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-[10px]">{log.duration}ms</span>
                        <span>{new Date(log.timestamp).toISOString().split('T')[1].replace('Z', '')}</span>
                      </div>
                    </button>
                    
                    {isExpanded && (
                      <div className="border-t border-zinc-100 bg-zinc-950 p-4 text-sm text-zinc-300">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Request</h4>
                            <div className="rounded-md bg-black/50 p-3 font-mono text-xs overflow-x-auto border border-white/5">
                              <div className="text-blue-400 mb-2">{log.method} {log.url}</div>
                              {log.requestHeaders && Object.entries(log.requestHeaders).map(([k, v]) => (
                                <div key={k}><span className="text-zinc-500">{k}:</span> <span className="text-green-300">{v}</span></div>
                              ))}
                              {log.requestBody && (
                                <div className="mt-3 pt-3 border-t border-white/10 text-zinc-300">
                                  <pre>{JSON.stringify(log.requestBody, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Response</h4>
                            <div className="rounded-md bg-black/50 p-3 font-mono text-xs overflow-x-auto border border-white/5 h-full max-h-[400px]">
                              {log.error ? (
                                <div className="text-red-400">{log.error}</div>
                              ) : (
                                <pre className={isError ? "text-red-300" : "text-zinc-300"}>
                                  {JSON.stringify(log.responseBody, null, 2)}
                                </pre>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
