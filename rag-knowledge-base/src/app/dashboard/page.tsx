import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        Manage your knowledge base and ask questions grounded in your documents.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/documents"
          className="group rounded-2xl border border-zinc-200 p-6 transition hover:border-zinc-900 hover:shadow-sm dark:border-zinc-800 dark:hover:border-white"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Documents</h2>
            <span
              aria-hidden
              className="text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-900 dark:group-hover:text-white"
            >
              →
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Upload PDFs, text, or markdown. Each file is chunked and embedded so
            you can query it later.
          </p>
        </Link>

        <div className="rounded-2xl border border-dashed border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-500">Chat</h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Ask questions and get answers cited to the exact chunks that support
            them. Ships in Phase 3.
          </p>
        </div>
      </div>
    </div>
  );
}
