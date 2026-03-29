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
src/index.ts          # Core logic: RSS fetch, XML parse, KV dedup, Telegram notify
src/roast.ts          # Optional add-on: Claude API roast generator
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
| Seed endpoint secret | `wrangler secret put SEED_SECRET` |
| Anthropic API key (optional) | `wrangler secret put ANTHROPIC_API_KEY` |

`wrangler.toml` is committed with placeholder values. Personal values are excluded from git via `git update-index --skip-worktree wrangler.toml`.

---

## Key implementation notes

- **XML parser** must use `ignoreAttributes: true` — without it, `<guid isPermaLink="true">` parses as an object instead of a string, silently breaking deduplication.
- **KV entries** are capped at 200 GUIDs per user (`seen:<username>`) to prevent unbounded growth.
- **`/seed` endpoint** pre-populates KV on first deploy to avoid notifying the entire review history. Call it once immediately after deploying, before adding the bot to the group chat.
- **Roast add-on** (`src/roast.ts`) — entirely opt-in, gated on `ANTHROPIC_API_KEY`. Calls Claude Haiku after each notification to generate a witty roast of the review text, posted as a threaded Telegram reply via `reply_to_message_id`. Only fires for entries with a written description (the `<description>` field, stripped of HTML and Letterboxd's "Watched on Weekday Month DD, YYYY." metadata prefix). Roast errors are caught and logged without blocking notifications.

---

## Development

```bash
npm install
npx tsc --noEmit                                              # type check
npx wrangler dev                                              # local server
curl "http://localhost:8787/cdn-cgi/handler/scheduled"        # trigger cron
curl "http://localhost:8787/seed"                             # trigger seed
```

## Deployment

```bash
npx wrangler deploy
curl https://letterboxd-notifier.<subdomain>.workers.dev/seed   # first deploy only
```
