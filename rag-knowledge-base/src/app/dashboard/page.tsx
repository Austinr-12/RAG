import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Manage your knowledge base and ask questions grounded in your documents.
        </p>
      </header>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <FeatureCard
          href="/dashboard/documents"
          title="Documents"
          body="Upload PDFs, text, or markdown. Files are chunked and embedded for retrieval."
          icon={
            <>
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
              <path d="M14 3v6h6" />
              <path d="M9 14h6" />
              <path d="M9 18h4" />
            </>
          }
        />
        <FeatureCard
          href="/dashboard/chat"
          title="Chat"
          body="Ask questions and get answers cited to the exact chunks that support them."
          icon={
            <>
              <path d="M21 12a8 8 0 1 1-3.3-6.5" />
              <path d="M21 5v4h-4" />
              <path d="M8 12h.01M12 12h.01M16 12h.01" />
            </>
          }
        />
      </div>
    </div>
  );
}

type CardProps = {
  href?: string;
  title: string;
  body: string;
  badge?: string;
  disabled?: boolean;
  icon: React.ReactNode;
};

function FeatureCard({ href, title, body, badge, disabled, icon }: CardProps) {
  const shell = disabled
    ? "border-dashed border-zinc-200 dark:border-zinc-800"
    : "border-zinc-200 hover:border-zinc-900 hover:shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.15)] dark:border-zinc-800 dark:hover:border-white dark:hover:shadow-[0_1px_0_rgba(255,255,255,0.05),0_8px_24px_-12px_rgba(0,0,0,0.6)]";

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            disabled
              ? "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
              : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
          }`}
        >
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
            {icon}
          </svg>
        </div>
        {badge ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {badge}
          </span>
        ) : (
          <span
            aria-hidden
            className="text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-900 dark:group-hover:text-white"
          >
            →
          </span>
        )}
      </div>
      <h2
        className={`mt-6 text-lg font-medium ${
          disabled ? "text-zinc-500" : ""
        }`}
      >
        {title}
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </>
  );

  const base = `group rounded-2xl border p-6 transition ${shell}`;

  return href && !disabled ? (
    <Link href={href} className={base}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}
