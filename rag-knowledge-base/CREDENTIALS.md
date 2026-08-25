# Credential rotation guide

> Any secret that appeared in a Claude Code transcript or public commit must be
> considered compromised. This file lists every secret this project uses, where
> it lives, where to rotate it, and how to plug the new value back in.

## Why this matters

During setup, the DB password, OpenAI key, and Clerk secret all appeared in chat
transcripts. Treat all four production secrets below as **compromised** and
rotate them before:

- Sharing the repository publicly
- Deploying to any URL that other people can reach
- Storing any real user data

Development against these keys locally is fine — the risk is exposure, not use.

---

## What's in `.env`

Only these three lines hold actual secrets. Everything else in `.env` is
non-sensitive routing config.

| Env var | What it is | Sensitivity |
|---|---|---|
| `OPENAI_API_KEY` | Bearer token for `api.openai.com` — anyone with this can burn your credits | 🔴 High |
| `CLERK_SECRET_KEY` | Server-side Clerk API key (starts with `sk_`) — anyone with this can create sessions and read users | 🔴 High |
| `DATABASE_URL` | Full Postgres connection URL including your Supabase project password | 🔴 High |
| `DIRECT_URL` | Same DB password as `DATABASE_URL` — rotates together | 🔴 High |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client-side Clerk key (starts with `pk_`) — shipped to browsers, so not secret, **but** you should still rotate the pair when rotating the secret to keep them from the same generation | 🟡 Ship in bundle by design |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `SIGN_UP_URL` / `_FALLBACK_REDIRECT_URL` (×4) | Route paths only | ⚪ Not sensitive |

---

## Rotation checklist

Do these in order. Each takes 1-3 minutes. Restart `next dev` after all four
are updated.

### 1. OpenAI API key

- Go to **[platform.openai.com/api-keys](https://platform.openai.com/api-keys)**
- Find any key labeled for this project (or the one whose last 4 chars match
  what's in your `.env` — OpenAI shows a masked preview like `sk-proj-...2WkA`)
- Click **"Revoke"** on the old key
- Click **"Create new secret key"**
  - Name: `rag-kb-dev` (or `rag-kb-prod` if this is a live env)
  - Project: default is fine
  - Permissions: **Read + Write** on `Model capabilities` (this is what
    embeddings + chat need). Restrict everything else you don't use.
- Copy the new key **immediately** — OpenAI shows it once, then hides it forever
- In `.env`:
  ```
  OPENAI_API_KEY=sk-proj-<new-key-here>
  ```
- **Don't** wrap in quotes, don't add spaces, don't trailing-comma. Save as
  UTF-8 without BOM.

### 2. Clerk keys (secret + publishable, rotate together)

- Go to **[dashboard.clerk.com](https://dashboard.clerk.com)** → pick your app
- Left sidebar: **API keys**
- You'll see two keys for each environment (development / production):
  - **Publishable key** (`pk_test_...` or `pk_live_...`)
  - **Secret key** (`sk_test_...` or `sk_live_...`)
- For the environment you're rotating (Development for local dev):
  - Click the **⋮** menu next to the secret key → **Regenerate**
  - Confirm — this invalidates all active sessions signed by the old key, so
    anyone currently signed in will get bounced to `/sign-in`. That's expected.
  - The publishable key does NOT rotate automatically — but it's not a secret,
    it's designed to ship to browsers. You can leave it, or regenerate it
    manually for hygiene. If you regenerate the publishable key too, copy the
    new one.
- In `.env`:
  ```
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<new>
  CLERK_SECRET_KEY=sk_test_<new>
  ```

### 3. Supabase database password

- Go to **[supabase.com/dashboard](https://supabase.com/dashboard)** → pick
  your project (`rcmwbfirmelhbnokqiuu` per current `.env`)
- Settings → **Database** (left sidebar under "Configuration")
- Scroll to **"Database password"** section
- Click **"Reset database password"**
- Supabase generates a new one — **copy it before closing the modal**, it isn't
  shown again
- Now go to Settings → Database → **Connection string** tab
- Copy the **Session pooler** URL (used by our Prisma adapter). It looks like:
  ```
  postgresql://postgres.rcmwbfirmelhbnokqiuu:<PASSWORD>@aws-1-us-west-1.pooler.supabase.com:5432/postgres
  ```
- Paste your new password in place of `<PASSWORD>` (URL-encode any special
  characters — Supabase-generated passwords usually don't need this, but if
  yours has `@`, `#`, `%`, etc, encode them)
- In `.env` — both `DATABASE_URL` and `DIRECT_URL` use the same connection
  string; update both:
  ```
  DATABASE_URL=postgresql://postgres.rcmwbfirmelhbnokqiuu:<new-password>@aws-1-us-west-1.pooler.supabase.com:5432/postgres
  DIRECT_URL=postgresql://postgres.rcmwbfirmelhbnokqiuu:<new-password>@aws-1-us-west-1.pooler.supabase.com:5432/postgres
  ```

### 4. Verify

```powershell
cd rag-knowledge-base
# Kill any running next dev process, then:
npx prisma migrate status
```
Should print `Database schema is up to date!`. If it fails with the tenant/user
error, the DB password or URL is wrong.

```powershell
npm run dev
```
Sign in, upload a doc, ask a chat question. If all three round-trips succeed,
all four secrets are rotated correctly.

---

## Going forward — best practices for a solo project

- **Never** paste secrets into any chat, ticket, or issue tracker, including
  Claude Code. If you have to reference one, redact the middle
  (`sk-proj-...2WkA`) and never share it verbatim.
- **Never** commit `.env`. It's already in `.gitignore` — verify:
  ```powershell
  git check-ignore -v .env
  ```
  Should print a line pointing at `.gitignore`.
- Use `.env.example` (checked in, no real values) so anyone cloning the repo
  can see which variables are needed without seeing your values.
- If you deploy: put secrets in the platform's secret manager (Vercel env
  vars, Railway secrets, etc.) — never in a committed file.
- Rotate on any suspicion of compromise. It costs 5 minutes and saves you from
  wondering.

---

## Emergency: what to do if a key leaks right now

1. Revoke it in the provider dashboard **first** (URLs above) — this stops the
   bleeding regardless of what else you do.
2. Then rotate per the checklist above.
3. For OpenAI specifically: also check **Usage** in the dashboard for any
   unexpected activity in the past 24 hours. Set a low **hard cap** in
   Settings → Limits so future leaks can't drain the account.
