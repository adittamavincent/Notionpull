export type LogEntry = {
  id: string;
  timestamp: number;
  duration: number;
  method: string;
  url: string;
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

export function getLogs(): LogEntry[] {
  const store = getStore();
  return store.notionLogs ?? [];
}

export function clearLogs() {
  const store = getStore();
  if (store.notionLogs) {
    store.notionLogs.length = 0;
  }
}
