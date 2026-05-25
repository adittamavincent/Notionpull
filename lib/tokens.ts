"use client";

import type { NotionTokenEntry } from "@/types/notion";

const STORAGE_KEY = "notion_tokens";
const ACTIVE_KEY = "notion_active_token_label";

export function getTokens(): NotionTokenEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveTokens(tokens: NotionTokenEntry[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function addToken(entry: NotionTokenEntry) {
  const tokens = getTokens().filter((token) => token.label !== entry.label);
  saveTokens([...tokens, entry]);
  setActiveTokenLabel(entry.label);
}

export function deleteToken(label: string) {
  saveTokens(getTokens().filter((token) => token.label !== label));
  if (getActiveTokenLabel() === label) {
    const next = getTokens().find((token) => token.label !== label);
    if (next) setActiveTokenLabel(next.label);
    else window.localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveTokenLabel(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function setActiveTokenLabel(label: string) {
  window.localStorage.setItem(ACTIVE_KEY, label);
}

export function maskToken(token: string): string {
  const prefix = token.startsWith("ntn_") ? "ntn_" : token.slice(0, 4);
  return `${prefix}••••••••`;
}
