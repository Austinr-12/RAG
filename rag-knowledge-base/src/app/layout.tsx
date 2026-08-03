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
          <header className="border-b border-zinc-200 dark:border-zinc-800">
            <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
              <Link href="/" className="font-semibold tracking-tight">
                RAG Knowledge Base
              </Link>
              <div className="flex items-center gap-4 text-sm">
                <Show when="signed-in">
                  <Link
                    href="/dashboard"
                    className="text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/dashboard/documents"
                    className="text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                  >
                    Documents
                  </Link>
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="redirect">
                    <button className="text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="redirect">
                    <button className="inline-flex h-9 items-center rounded-full bg-zinc-900 px-4 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
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
