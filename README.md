# Letterboxd RSS to Telegram

A Cloudflare Worker that watches [Letterboxd](https://letterboxd.com) RSS feeds and posts a Telegram message to a group chat whenever a tracked user logs a film.

**Example notification:**
```
🎬 alice watched Alien Romulus (2024) ★★★½
https://letterboxd.com/alice/film/alien-romulus/

🎬 bob watched The Substance (2024) ★★★★★ ⚠️ Spoiler
https://letterboxd.com/bob/film/the-substance/
```

Runs automatically every 30 minutes. No server to manage — it's a Cloudflare Worker.

---

## Using it

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)
- A Telegram account
- [Node.js](https://nodejs.org) installed locally (for the Wrangler CLI)

---

### 1. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** it gives you (looks like `123456:ABC-DEF...`)
4. Add the bot to your group chat as a member

---

### 2. Get your group chat ID

1. Add [@userinfobot](https://t.me/userinfobot) to your group chat temporarily
2. It will reply with the group's chat ID (a negative number like `-1001234567890`)
3. Remove @userinfobot from the group

---

### 3. Fork and clone

Fork this repo on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-username>/letterboxdRSSToTelegram.git
cd letterboxdRSSToTelegram
npm install
```

---

### 4. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

This opens a browser window to authenticate with your Cloudflare account.

---

### 5. Create the KV namespace

```bash
wrangler kv namespace create SEEN_REVIEWS
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SEEN_REVIEWS"
id = "paste-your-id-here"
```

---

### 6. Configure your usernames

Edit `wrangler.toml` and set the Letterboxd usernames you want to track:

```toml
[vars]
USERNAMES = "alice,bob,carol"
```

---

### 7. Set secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
# paste your bot token when prompted

wrangler secret put TELEGRAM_CHAT_ID
# paste your chat ID when prompted
```

Secrets are encrypted and stored by Cloudflare — they are never committed to your repo.

---

### 8. Deploy

```bash
wrangler deploy
```

That's it. The Worker will run every 30 minutes and post to your group chat whenever someone logs a film.

---

## Development

### Local setup

```bash
npm install
```

### Type checking

```bash
npx tsc --noEmit
```

### Running locally

Cloudflare Workers can be run locally using Wrangler's dev server. Because this Worker only exports a `scheduled` handler (no HTTP handler), you trigger it manually:

```bash
wrangler dev
```

Then in a separate terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Note: local runs won't have access to your real KV data or secrets unless you configure a `.dev.vars` file (see [Wrangler docs](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets)).

### Project structure

```
src/
  index.ts          # Everything: RSS fetch, XML parse, KV dedup, Telegram notify
wrangler.toml       # Worker name, cron schedule, KV binding, USERNAMES var
config.example.json # Documents the required vars and secrets (not used at runtime)
```

### How it works

1. Cron fires every 30 minutes
2. For each username in `USERNAMES`, fetches `https://letterboxd.com/<username>/rss/`
3. Parses the XML feed and extracts entries (title, link, rating, spoiler flag)
4. Loads previously seen entry GUIDs from Cloudflare KV (`seen:<username>`)
5. Sends a Telegram message for any entry not yet seen
6. Saves the updated GUID list back to KV to prevent duplicates

### Contributing

Pull requests welcome. Please keep the code free of hardcoded personal data (usernames, tokens, chat IDs) — all config must remain external.

---

## License

MIT
