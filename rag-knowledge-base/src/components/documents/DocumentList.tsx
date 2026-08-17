"use client";

import { useEffect, useState } from "react";

type Doc = {
  id: string;
  name: string;
  createdAt: string;
  chunkCount: number;
};

type Props = { refreshKey: number };

export function DocumentList({ refreshKey }: Props) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch("/api/documents");
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = (await res.json()) as { documents: Doc[] };
        if (!cancelled) setDocs(data.documents);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function remove(id: string) {
    setDeletingId(id);
    // Why: optimistic remove — snapshot prior state so we can restore on failure.
    const snapshot = docs;
    setDocs((prev) => prev?.filter((d) => d.id !== id) ?? null);
    try {
      const res = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    } catch (err) {
      setDocs(snapshot);
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  if (docs === null && !error) {
    return (
      <div className="rounded-2xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
        Loading…
      </div>
    );
  }
  if (error && !docs) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (docs && docs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No documents yet — upload one above to get started.
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-2xl border border-zinc-200 divide-y divide-zinc-200 dark:border-zinc-800 dark:divide-zinc-800">
      {docs!.map((d) => (
        <li
          key={d.id}
          className="group flex items-center gap-4 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
              <path d="M14 3v6h6" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{d.name}</p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
              <span>
                {d.chunkCount} chunk{d.chunkCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
                ·
              </span>
              <span>{formatDate(d.createdAt)}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={deletingId === d.id}
            onClick={() => void remove(d.id)}
            className="rounded-full px-3 py-1.5 text-sm text-zinc-500 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            {deletingId === d.id ? "Deleting…" : "Delete"}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Why: consistent formatting across locales. Uses today/yesterday for recency
// and ISO-style date otherwise — reads as "modern app" not "raw timestamp".
function formatDate(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (wasYesterday) return "Yesterday";
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
