"use client";

import { FormEvent, useState, useEffect } from "react";
import type { NotionTokenEntry } from "@/types/notion";
import { addToken, deleteToken, maskToken, setActiveTokenLabel } from "@/lib/tokens";
import { Eye, EyeOff } from "lucide-react";

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
  const [showToken, setShowToken] = useState(false);

  // Close on Escape key press
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
      setShowToken(false);
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

  // Back-compatible selection handler
  function setActive(labelToSet: string) {
    setActiveTokenLabel(labelToSet);
    onChange();
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/35 p-4" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="ml-auto flex h-full w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-semibold">Tokens</h2>
          <button className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 font-medium text-lg leading-none" onClick={onClose} aria-label="Close">
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
              autoComplete="off"
            />
            <div className="relative">
              <input
                className="w-full rounded-md border border-zinc-300 pl-3 pr-10 py-2 text-sm outline-none focus:border-zinc-900"
                placeholder="ntn_xxx"
                type="text"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                style={{ WebkitTextSecurity: showToken ? "none" : "disc" } as React.CSSProperties}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                onClick={() => setShowToken(!showToken)}
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <button
              className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400 hover:bg-zinc-800 transition"
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
