# Stack v0.2 — 60-Second Demo Script

## Table of Contents

1. [Setup (pre-recording)](#setup-pre-recording)
2. [Timeline](#timeline)
3. [Voiceover](#voiceover)
4. [Post-record](#post-record)

---

## Setup (pre-recording)

- Terminal: iTerm2 or Warp, dark theme, 14pt monospace. Clear history (`clear`, then close and reopen the tab so scrollback is empty).
- Shell: `cd` into a fresh empty directory — e.g. `/tmp/stack-demo`. Nothing else in it.
- Browser: have a Supabase tab open and **already logged in** so the OAuth consent screen loads instantly, not the login screen.
- Window layout: terminal takes ~65% of screen width, browser on the right. Record at 1920×1080 or retina 2x.
- Homebrew tap already added in PATH — confirm `which stack` returns nothing before starting (verifies clean state). If `stack` is already installed, `brew uninstall ashlrai/ashlr/stack` first so the install step is real.
- Zoom: bump terminal font to 16pt for recording legibility.

---

## Timeline

| Time (s) | Action | Exact command / input | Expected output | Visual focus |
|---|---|---|---|---|
| 0–5 | Show empty directory | `ls` (returns nothing) | Empty prompt | Terminal, directory path visible in prompt |
| 5–12 | Install Stack via brew | `brew install ashlrai/ashlr/stack` | Tap clone + bottle install, completes in ~5s | Full terminal — watch the brew progress line |
| 12–18 | Verify install + show version | `stack --version` | `stack 0.2.0` | Terminal |
| 18–28 | Init project with template | `stack init --template nextjs-supabase-posthog` | Template scaffold: creates Next.js files, `.stack.toml`, `.env.local` skeleton, `.mcp.json` | Terminal — let the file-creation lines scroll |
| 28–38 | Provision Supabase | *(automatic — part of init flow)* | Browser jumps to Supabase OAuth consent screen | Switch visual focus to browser for 3–4s, then back to terminal as spinner runs: `provisioning supabase… ✓` |
| 38–46 | SDK install prompts | *(automatic — part of init flow)* | Terminal: `install @supabase/supabase-js? (Y/n)` → Y; `install posthog-js? (Y/n)` → Y; spinner for each | Terminal — type Y for each prompt, watch the install spinners |
| 46–50 | Show wired secrets (no values) | `stack doctor` | Green checkmarks for supabase + posthog; phantom placeholder tokens visible, not raw keys | Terminal |
| 50–55 | Boot the app | `stack exec -- bun dev` | `bun dev` output: `ready - started server on 0.0.0.0:3000` | Terminal, then quick pan to browser |
| 55–60 | Browser shows live app | *(switch to browser, open localhost:3000)* | Next.js default page loads; Supabase health indicator green | Browser — hold 2–3s, then cut to end card |

**Total: 60 seconds.**

---

## Voiceover

Sync one sentence per ~7-second beat. Write these out on a teleprompter doc or sticky note before recording — don't read off-screen.

| Beat | Time (s) | Line |
|---|---|---|
| 1 | 0–7 | "Every new project starts with the same hour: tab-hopping between six dashboards, copying keys, pasting them wrong." |
| 2 | 7–14 | "Stack v0.2 collapses that into one command — install takes about five seconds." |
| 3 | 14–21 | "Stack init with a template picks your stack and starts provisioning immediately." |
| 4 | 21–28 | "The Supabase OAuth dance opens automatically — pick your org, and Stack creates the project." |
| 5 | 28–35 | "SDKs get installed inline — no separate npm install, no copy-pasting package names." |
| 6 | 35–42 | "Stack doctor shows every secret is stored in Phantom, the encrypted local vault — raw keys never touch disk." |
| 7 | 42–50 | "Stack exec resolves the secrets at spawn time — bun dev just works." |
| 8 | 50–60 | "Thirty-nine providers. One command. Stack dot ashlr dot ai." |

---

## Post-record

**Upload:** YouTube (unlisted first for review) + upload the 1080p MP4 to the repo's `assets/` or the site's `/public/video/` for embedding on stack.ashlr.ai.

**Thumbnail suggestion:** Dark terminal background, two-column layout. Left: the chaos side — six browser tabs open, `.env.local` with redacted keys. Right: clean terminal with `stack init --template nextjs-supabase-posthog` and green checkmarks. Text overlay: **"39 providers. One command."** in the Inter/Geist font used on the site. No stock photos.

**Caption (for YouTube / X post):**

> 39 providers. One command.
>
> Stack v0.2 — `stack init --template nextjs-supabase-posthog` provisions Supabase, installs the SDKs, wires Phantom secrets, and boots your app in under 60 seconds.
>
> Free. MIT. No telemetry.
> stack.ashlr.ai
