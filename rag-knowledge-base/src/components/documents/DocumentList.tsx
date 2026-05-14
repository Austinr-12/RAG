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
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }
  if (error && !docs) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (docs && docs.length === 0) {
    return <p className="text-sm text-zinc-500">No documents yet.</p>;
  }

  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {docs!.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{d.name}</p>
            <p className="text-xs text-zinc-500">
              {d.chunkCount} chunk{d.chunkCount === 1 ? "" : "s"} ·{" "}
              {new Date(d.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            disabled={deletingId === d.id}
            onClick={() => void remove(d.id)}
            className="text-sm text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            {deletingId === d.id ? "Deleting…" : "Delete"}
          </button>
        </li>
      ))}
    </ul>
  );
}
