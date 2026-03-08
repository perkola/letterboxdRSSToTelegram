# Letterboxd Telegram Notifier

A Cloudflare Worker that polls Letterboxd RSS feeds and sends Telegram notifications when tracked users log a movie watch.

Designed to be forkable — no hardcoded user data, all configuration is external.

---

## What it does

1. Runs on a cron trigger (every 30 minutes)
2. Fetches the Letterboxd RSS feed for each configured username
3. Compares entries against previously seen GUIDs stored in Cloudflare KV
4. Sends a Telegram message to a group chat for each new entry
5. Saves new GUIDs back to KV to avoid duplicate notifications

---

## Tech stack

- **Runtime**: Cloudflare Workers (V8 isolate — not Node.js)
- **Language**: TypeScript
- **Scheduling**: Cloudflare Cron Trigger
- **State**: Cloudflare KV (stores seen entry GUIDs)
- **RSS parsing**: lightweight Workers-compatible XML/feed parser
- **Notifications**: Telegram Bot API via raw `fetch()` — no SDK

---

## Project structure

```
/
├── src/
│   └── index.ts          # Main Worker entry point
├── config.example.json   # Example config — copy to config.json and edit
├── wrangler.toml         # Cloudflare Workers config (cron, KV binding, vars)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Configuration

### `wrangler.toml`

```toml
name = "letterboxd-notifier"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[triggers]
crons = ["*/30 * * * *"]

[[kv_namespaces]]
binding = "SEEN_REVIEWS"
id = "<your-kv-namespace-id>"

[vars]
USERNAMES = "alice,bob,carol"   # Comma-separated Letterboxd usernames to track
```

### Secrets (never commit these)

Set via Wrangler CLI:

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

- `TELEGRAM_BOT_TOKEN` — from @BotFather on Telegram
- `TELEGRAM_CHAT_ID` — the group chat ID (use @userinfobot or the Telegram API to find it)

---

## Telegram message format

Each notification looks like:

```
🎬 alice watched Alien Romulus (2024) ★★★½
https://letterboxd.com/alice/film/alien-romulus/
```

With spoiler flag if present:
```
🎬 alice watched Alien Romulus (2024) ★★★½ ⚠️ Spoiler
https://letterboxd.com/alice/film/alien-romulus/
```

Rating is omitted if not given. All diary entries are included — not just written reviews. The link points to the user's entry where any review text can be read.

---

## Letterboxd RSS

Each user's feed is at:
```
https://letterboxd.com/<username>/rss/
```

Relevant fields per entry:
- `<title>` — movie title and year
- `<link>` — URL to the user's diary entry
- `<guid>` — unique ID, used for deduplication
- `<letterboxd:memberRating>` — star rating (e.g. `3.5`)
- `<letterboxd:spoilerWarning>` — present if spoiler flagged
- `<pubDate>` — publication date

---

## State / deduplication

Seen entry GUIDs are stored in Cloudflare KV under a single key per username, e.g. `seen:alice`. Value is a JSON array of GUID strings. On each run, only entries with GUIDs not in the stored list are notified. After notifying, the new GUIDs are merged and saved back.

---

## Telegram Bot API

Notifications are sent via a plain HTTPS POST — no library needed:

```typescript
await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: message,
    disable_web_page_preview: false
  })
});
```

---

## Setup guide (for forks)

1. Clone the repo
2. Copy `config.example.json` → `config.json` and add your Letterboxd usernames
3. Install Wrangler: `npm install -g wrangler`
4. Create a KV namespace: `wrangler kv:namespace create SEEN_REVIEWS`
5. Paste the namespace ID into `wrangler.toml`
6. Set secrets: `wrangler secret put TELEGRAM_BOT_TOKEN` and `wrangler secret put TELEGRAM_CHAT_ID`
7. Deploy: `wrangler deploy`

---

## Open source requirements

This project is open source and intended to be forked by anyone who wants to run their own Letterboxd notification group. Keep this in mind throughout:

- No hardcoded usernames, tokens, chat IDs, or any personal data anywhere in the codebase
- All user-specific config goes in `wrangler.toml` vars or Wrangler secrets
- Code should be clean and readable — other developers will read it
- Include a MIT `LICENSE` file in the repo root

---

## README requirements

The README is the most important file for adoption. Structure it in this order:

### 1. What it does (top of README)
Brief description with a screenshot or example of what a Telegram notification looks like. Make it immediately clear what the project is for.

### 2. Using it (fork & deploy guide — primary audience)
Step-by-step for someone who just wants to run their own instance. Should require zero TypeScript knowledge. Cover:
- Prerequisites (Cloudflare account, Telegram account)
- Creating the Telegram bot via @BotFather
- Getting the group chat ID via the Telegram API (`getUpdates`)
- Forking the repo
- Configuring `wrangler.toml` with their usernames
- Creating the KV namespace
- Setting secrets via `wrangler secret put`
- Deploying with `wrangler deploy`

### 3. Development (secondary audience)
For developers who want to modify or contribute:
- Local setup and `npm install`
- How to run/test locally with Wrangler
- Project structure explanation
- How to contribute

---

## Notes for Claude Code

- Do not use Node.js built-ins (`fs`, `path`, etc.) — this runs in the Workers V8 runtime
- Use native `fetch()` for all HTTP calls
- Use a Workers-compatible RSS/XML parser — verify it has no Node dependencies
- Keep the implementation in a single `src/index.ts` file unless complexity warrants splitting
- The Worker exports a `scheduled` handler, not a `fetch` handler
- All secrets and config are injected via the Workers environment — never read from disk
