# Letterboxd RSS to Telegram

A Cloudflare Worker that polls Letterboxd RSS feeds every 30 minutes and sends Telegram notifications when tracked users log a film. Designed to be forkable — no hardcoded user data.

---

## Tech stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **State**: Cloudflare KV
- **RSS parsing**: `fast-xml-parser`
- **Notifications**: Telegram Bot API via `fetch()`

---

## Project structure

```
src/index.ts          # All logic: RSS fetch, XML parse, KV dedup, Telegram notify
wrangler.toml         # Worker config: cron schedule, KV binding, USERNAMES var
```

The Worker exports two handlers:
- **`scheduled`** — cron, polls feeds and sends notifications
- **`fetch`** — serves `GET /seed` for one-time KV initialisation on first deploy

---

## Configuration

| What | Where |
|---|---|
| Tracked usernames | `wrangler.toml` → `USERNAMES` var |
| KV namespace ID | `wrangler.toml` → `[[kv_namespaces]]` |
| Telegram bot token | `wrangler secret put TELEGRAM_BOT_TOKEN` |
| Telegram chat ID | `wrangler secret put TELEGRAM_CHAT_ID` |

`wrangler.toml` is committed with placeholder values. Personal values are excluded from git via `git update-index --skip-worktree wrangler.toml`.

---

## Key implementation notes

- **XML parser** must use `ignoreAttributes: true` — without it, `<guid isPermaLink="true">` parses as an object instead of a string, silently breaking deduplication.
- **KV entries** are capped at 200 GUIDs per user (`seen:<username>`) to prevent unbounded growth.
- **`/seed` endpoint** pre-populates KV on first deploy to avoid notifying the entire review history. Call it once immediately after deploying, before adding the bot to the group chat.

---

## Development

```bash
npm install
npx tsc --noEmit                                              # type check
npx wrangler dev                                              # local server
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"      # trigger cron
curl "http://localhost:8787/seed"                             # trigger seed
```

## Deployment

```bash
npx wrangler deploy
curl https://letterboxd-notifier.<subdomain>.workers.dev/seed   # first deploy only
```
