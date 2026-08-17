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
      // Why: dragenter/dragover BOTH need preventDefault or the browser refuses to
      // fire drop. dragOver also sets dropEffect so the cursor shows the copy icon.
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      // Why: dragLeave fires whenever the cursor crosses a child element (button,
      // text). Only reset when we've actually left the drop zone — checked via
      // relatedTarget not being a descendant of the zone.
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
      className={`group relative overflow-hidden rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
        dragging
          ? "scale-[1.01] border-zinc-900 bg-zinc-50 dark:border-white dark:bg-zinc-900"
          : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
      }`}
    >
      {/* Subtle inner glow while dragging — modern touch, not distracting. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.04),transparent_60%)] opacity-0 transition-opacity duration-300 dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_60%)] ${
          dragging ? "opacity-100" : ""
        }`}
      />

      <div
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
          busy
            ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        }`}
      >
        {busy ? (
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 animate-spin text-zinc-500"
            aria-hidden
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="2"
            />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <path d="M12 3v12m0 0-4-4m4 4 4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        )}
      </div>

      <p className="mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {busy
          ? "Uploading and indexing…"
          : dragging
            ? "Release to upload"
            : "Drop a file here or click to browse"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        PDF, plain text, or markdown · up to 10&thinsp;MB
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-5 inline-flex h-9 items-center rounded-full bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
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
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
