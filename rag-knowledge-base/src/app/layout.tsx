import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAG Knowledge Base",
  description: "Upload documents, ask questions, get cited answers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
          <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/70 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/70">
            <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
              <Link
                href="/"
                className="flex items-center gap-2 font-semibold tracking-tight"
              >
                <BrandMark />
                <span>RAG Knowledge Base</span>
              </Link>
              <div className="flex items-center gap-1 text-sm">
                <Show when="signed-in">
                  <NavLink href="/dashboard">Dashboard</NavLink>
                  <NavLink href="/dashboard/documents">Documents</NavLink>
                  <div className="ml-2">
                    <UserButton />
                  </div>
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="redirect">
                    <button className="rounded-full px-3 py-1.5 text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="redirect">
                    <button className="ml-1 inline-flex h-9 items-center rounded-full bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                      Sign up
                    </button>
                  </SignUpButton>
                </Show>
              </div>
            </nav>
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
    >
      {children}
    </Link>
  );
}

// Small monogram — two overlapping squares hinting at layered chunks/retrieval.
// Kept as inline SVG so no asset request and it inherits currentColor.
function BrandMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="h-4 w-4"
        aria-hidden
      >
        <rect x="3" y="3" width="10" height="10" rx="1.5" />
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      </svg>
    </span>
  );
}
