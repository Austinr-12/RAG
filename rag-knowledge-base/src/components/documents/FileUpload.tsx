"use client";

import { useCallback, useRef, useState } from "react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown";

type Props = { onUploaded: () => void };

export function FileUpload({ onUploaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_BYTES) {
        setError("File exceeds 10MB limit");
        return;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
        onUploaded();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
      className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
        dragging
          ? "border-zinc-900 bg-zinc-50 dark:border-white dark:bg-zinc-900"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {busy ? "Uploading and indexing…" : "Drop a PDF, .txt, or .md file here"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">or</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-3 inline-flex h-9 items-center rounded-full bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        Choose file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
