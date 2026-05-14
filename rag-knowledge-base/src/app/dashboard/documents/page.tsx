import { DocumentsPanel } from "@/components/documents/DocumentsPanel";

export default function DocumentsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload PDFs, text, or markdown. Each file is chunked and embedded for retrieval.
        </p>
      </header>
      <DocumentsPanel />
    </div>
  );
}
