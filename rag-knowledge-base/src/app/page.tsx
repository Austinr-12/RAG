import Link from "next/link";

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col">
      {/* Subtle radial backdrop — modern depth without being loud. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(0,0,0,0.05),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]"
      />

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-24 pb-16 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/60 px-3 py-1 text-xs font-medium text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Retrieval-augmented answers, cited to your sources
        </span>

        <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Your knowledge base,
          <br />
          <span className="text-zinc-500 dark:text-zinc-400">
            asked and answered.
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Upload PDFs, text, and markdown. Ask questions in plain language. Get
          answers grounded in the exact chunks that support them.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 hover:shadow dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Get started — it's free
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 text-sm font-medium text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-transparent dark:text-white dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature
            title="Upload"
            body="Drop in PDFs, plain text, or markdown. Files are chunked and embedded for fast semantic retrieval."
            icon={
              <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            }
          />
          <Feature
            title="Retrieve"
            body="Vector search across your embeddings finds the passages most relevant to your question."
            icon={
              <>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </>
            }
          />
          <Feature
            title="Cite"
            body="Every answer links back to the exact source chunk — no hallucinated references, no black box."
            icon={
              <>
                <path d="M4 5v14a2 2 0 0 0 2 2h9l5-5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2Z" />
                <path d="M14 21v-5h5" />
              </>
            }
          />
        </div>
      </section>
    </div>
  );
}

function Feature({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/50 p-6 backdrop-blur transition hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white">
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
          {icon}
        </svg>
      </div>
      <h3 className="mt-4 text-base font-medium">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}
