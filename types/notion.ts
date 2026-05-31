export type NotionTokenEntry = {
  label: string;
  token: string;
  addedAt: string;
  workspaceName?: string;
  workspaceIcon?: string;
};

export type DetectedObject = {
  type: "page" | "database" | "data_source";
  id: string;
  title: string;
  viewId?: string;
  views?: NotionDatabaseView[];
  columnDetails?: NotionColumnDetail[];
  dataSourceId?: string;
  dataSourceName?: string;
  columns?: string[];
  selectedColumns?: string[];
  properties?: Record<string, any>;
};

export type NotionDatabaseView = {
  id: string;
  title?: string;
};

export type NotionColumnDetail = {
  id?: string;
  name: string;
  visible?: boolean;
  width?: number;
};

export type NotionDatabaseViewDetails = {
  id: string;
  title?: string;
  configuration?: {
    properties?: Array<{
      property_id: string;
      visible?: boolean;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
  [key: string]: any;
};

export type TreeNodeKind = "page" | "database" | "data_source" | "row" | "block";

export type TreeNodeData = {
  id: string;
  title: string;
  kind: TreeNodeKind;
  depth: number;
  parentId?: string;
  viewId?: string;
  views?: NotionDatabaseView[];
  columnDetails?: NotionColumnDetail[];
  dataSourceId?: string;
  dataSourceName?: string;
  page?: NotionPage;
  children?: TreeNodeData[];
  error?: string;
  columns?: string[];
  selectedColumns?: string[];
  properties?: Record<string, any>;
};

export type NotionRichText = {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

export type NotionPage = {
  id: string;
  object: "page";
  properties?: Record<string, any>;
  [key: string]: any;
};

export type NotionDatabase = {
  id: string;
  object: "database";
  title?: NotionRichText[];
  properties?: Record<string, any>;
  data_sources?: Array<{ id: string; name?: string }>;
  [key: string]: any;
};

export type RowsResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};
