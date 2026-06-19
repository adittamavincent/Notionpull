export type LogEntry = {
  id: string;
  timestamp: number;
  duration: number;
  method: string;
  url: string;
  tracePath?: string;
  nameTag?: string;
  objectType?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  status: number;
  responseBody?: any;
  error?: string;
};

declare global {
  var notionLogs: LogEntry[] | undefined;
  var resolvedTitles: Record<string, string> | undefined;
  var viewToDatabase: Record<string, string> | undefined;
}

const getStore = () => {
  if (typeof globalThis !== "undefined") return globalThis;
  return {} as any;
};

export function addLog(log: LogEntry) {
  const store = getStore();
  if (!store.notionLogs) {
    store.notionLogs = [];
  }
  store.notionLogs.unshift(log);
}

export function saveResolvedTitle(id: string, title: string) {
  if (!id || !title || title.toLowerCase() === "untitled" || title.toLowerCase() === "untitled database") return;
  const store = getStore();
  if (!store.resolvedTitles) {
    store.resolvedTitles = {};
  }
  const cleanId = id.replace(/-/g, "").toLowerCase();
  store.resolvedTitles[cleanId] = title;
  store.resolvedTitles[id.toLowerCase()] = title;
}

export function getResolvedTitle(id: string): string | undefined {
  if (!id) return undefined;
  const store = getStore();
  const cleanId = id.replace(/-/g, "").toLowerCase();
  return store.resolvedTitles?.[cleanId] ?? store.resolvedTitles?.[id.toLowerCase()];
}

export function saveViewDatabase(viewId: string, databaseId: string) {
  if (!viewId || !databaseId) return;
  const store = getStore();
  if (!store.viewToDatabase) {
    store.viewToDatabase = {};
  }
  const cleanViewId = viewId.replace(/-/g, "").toLowerCase();
  const cleanDbId = databaseId.replace(/-/g, "").toLowerCase();
  store.viewToDatabase[cleanViewId] = cleanDbId;
  store.viewToDatabase[viewId.toLowerCase()] = databaseId.toLowerCase();
}

export function getViewDatabase(viewId: string): string | undefined {
  if (!viewId) return undefined;
  const store = getStore();
  const cleanViewId = viewId.replace(/-/g, "").toLowerCase();
  return store.viewToDatabase?.[cleanViewId] ?? store.viewToDatabase?.[viewId.toLowerCase()];
}

export function getLogs(): LogEntry[] {
  const store = getStore();
  const logs: LogEntry[] = store.notionLogs ?? [];
  return logs.map((log: LogEntry) => {
    let nameTag = log.nameTag;
    if (!nameTag || nameTag === "Untitled" || nameTag === "Untitled database" || nameTag === "Untitled data source" || nameTag === "Untitled view") {
      const path = log.url.replace("https://api.notion.com/v1", "");
      
      // 1. Pages
      const pageMatch = /\/pages\/([a-fA-F0-9-]{32,36})/.exec(path);
      if (pageMatch) {
        const resolved = getResolvedTitle(pageMatch[1]);
        if (resolved) {
          if (path.includes("/properties/")) {
            const propId = path.split("/properties/")[1]?.split("?")[0] ?? "";
            nameTag = `${resolved} (property: ${propId})`;
          } else if (path.endsWith("/markdown")) {
            nameTag = `${resolved} (markdown)`;
          } else {
            nameTag = resolved;
          }
        }
      }
      
      // 2. Blocks
      const blockMatch = /\/blocks\/([a-fA-F0-9-]{32,36})/.exec(path);
      if (blockMatch) {
        const resolved = getResolvedTitle(blockMatch[1]);
        if (resolved) {
          if (path.endsWith("/children") || path.includes("/children?")) {
            nameTag = `${resolved} (children)`;
          } else {
            nameTag = resolved;
          }
        }
      }
      
      // 3. Databases
      const dbMatch = /\/databases\/([a-fA-F0-9-]{32,36})/.exec(path);
      if (dbMatch) {
        const resolved = getResolvedTitle(dbMatch[1]);
        if (resolved) nameTag = resolved;
      }
      
      // 4. Data sources
      const dsMatch = /\/data_sources\/([a-fA-F0-9-]{32,36})/.exec(path);
      if (dsMatch) {
        const resolved = getResolvedTitle(dsMatch[1]);
        if (resolved) {
          if (path.endsWith("/templates") || path.includes("/templates?")) {
            nameTag = `${resolved} (templates)`;
          } else if (path.endsWith("/query") || path.includes("/query?")) {
            nameTag = `${resolved} (query)`;
          } else {
            nameTag = resolved;
          }
        }
      }
      
      // 5. Views
      const viewMatch = /\/views\/([a-fA-F0-9-]{32,36})/.exec(path);
      if (viewMatch) {
        const viewId = viewMatch[1];
        const dbId = getViewDatabase(viewId);
        const resolvedDb = dbId ? getResolvedTitle(dbId) : undefined;
        if (resolvedDb) {
          const viewType = log.responseBody?.type ?? "";
          const suffix = viewType ? `${viewType} view` : "view";
          if (path.includes("/queries/")) {
            nameTag = `${resolvedDb} (${suffix} query)`;
          } else if (path.includes("/queries") || path.endsWith("/queries")) {
            nameTag = `${resolvedDb} (${suffix} queries)`;
          } else {
            nameTag = `${resolvedDb} (${suffix})`;
          }
        }
      }

      // 6. Comments
      const commentsMatch = /\/comments\?block_id=([a-fA-F0-9-]{32,36})/.exec(path);
      if (commentsMatch) {
        const resolved = getResolvedTitle(commentsMatch[1]);
        if (resolved) {
          nameTag = `${resolved} (comments)`;
        }
      }
    }
    return { ...log, nameTag };
  });
}

export function clearLogs() {
  const store = getStore();
  if (store.notionLogs) {
    store.notionLogs.length = 0;
  }
}
