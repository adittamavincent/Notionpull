"use client";

import { FormEvent, useState } from "react";
import type { NotionTokenEntry } from "@/types/notion";
import { addToken, deleteToken, maskToken, setActiveTokenLabel } from "@/lib/tokens";

type Props = {
  open: boolean;
  tokens: NotionTokenEntry[];
  activeLabel: string | null;
  onClose: () => void;
  onChange: () => void;
};

export function TokenManager({ open, tokens, activeLabel, onClose, onChange }: Props) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!label.trim() || !token.trim()) {
      setError("Label and token required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/notion/verify", { headers: { "x-notion-token": token.trim() } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Token verify failed");
      addToken({
        label: label.trim(),
        token: token.trim(),
        addedAt: new Date().toISOString(),
        workspaceName: body.workspaceName,
        workspaceIcon: body.workspaceIcon ?? undefined
      });
      setLabel("");
      setToken("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify token.");
    } finally {
      setSaving(false);
    }
  }

  function remove(labelToDelete: string) {
    if (!window.confirm(`Delete token "${labelToDelete}"?`)) return;
    deleteToken(labelToDelete);
    onChange();
  }

  function setActive(labelToSet: string) {
    setActiveTokenLabel(labelToSet);
    onChange();
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/35 p-4">
      <div className="ml-auto flex h-full w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-semibold">Tokens</h2>
          <button className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="space-y-2">
            {tokens.map((entry) => (
              <div
                key={entry.label}
                className={`rounded-md border p-3 ${entry.label === activeLabel ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    className="mt-1"
                    type="radio"
                    checked={entry.label === activeLabel}
                    onChange={() => setActive(entry.label)}
                    aria-label={`Use ${entry.label}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry.label}</div>
                    <div className="truncate text-xs text-zinc-500">{entry.workspaceName ?? "Unverified workspace"}</div>
                    <div className="mt-1 text-xs text-zinc-400">{maskToken(entry.token)}</div>
                  </div>
                  <button className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => remove(entry.label)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!tokens.length && <div className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">No saved tokens.</div>}
          </div>

          <form className="mt-6 space-y-3" onSubmit={submit}>
            <h3 className="text-sm font-semibold">Add token</h3>
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              placeholder="Label, e.g. Work"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              placeholder="ntn_xxx"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <button
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              disabled={saving}
            >
              {saving ? "Connecting..." : "Connect & Save"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
