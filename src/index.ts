import { XMLParser } from "fast-xml-parser";

export interface Env {
  SEEN_REVIEWS: KVNamespace;
  USERNAMES: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

// Maximum number of GUIDs to retain per user in KV (prevents unbounded growth)
const MAX_SEEN_GUIDS = 200;

// ── RSS parsing ────────────────────────────────────────────────────────────────

interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  hasSpoiler: boolean;
}

async function fetchFeedEntries(username: string): Promise<FeedEntry[]> {
  const url = `https://letterboxd.com/${username}/rss/`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch RSS for ${username}: ${res.status}`);
    return [];
  }
  const xml = await res.text();
  return parseFeed(xml);
}

function parseFeed(xml: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    // Treat these tags as arrays so single-item feeds still return arrays
    isArray: (tagName) => tagName === "item",
  });

  const doc = parser.parse(xml);
  const items: unknown[] = doc?.rss?.channel?.item ?? [];

  return items.map((item: unknown) => {
    const i = item as Record<string, unknown>;
    const guid = String(i["guid"] ?? "");
    const title = String(i["title"] ?? "");
    const link = String(i["link"] ?? "");
    const hasSpoiler = Boolean(i["letterboxd:spoilerWarning"]);

    return { guid, title, link, hasSpoiler };
  });
}

// ── Telegram ───────────────────────────────────────────────────────────────────

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Telegram API error: ${res.status} ${body}`);
  }
}

function buildMessage(username: string, entry: FeedEntry): string {
  const spoilerStr = entry.hasSpoiler ? " ⚠️ Spoiler" : "";
  return `🎬 ${username} watched ${entry.title}${spoilerStr}\n${entry.link}`;
}

// ── KV helpers ─────────────────────────────────────────────────────────────────

async function getSeenGuids(kv: KVNamespace, username: string): Promise<Set<string>> {
  const raw = await kv.get(`seen:${username}`);
  if (!raw) return new Set();
  const parsed = JSON.parse(raw) as string[];
  return new Set(parsed);
}

async function saveSeenGuids(
  kv: KVNamespace,
  username: string,
  guids: Set<string>
): Promise<void> {
  const arr = Array.from(guids).slice(-MAX_SEEN_GUIDS);
  await kv.put(`seen:${username}`, JSON.stringify(arr));
}

// ── Scheduled handler ──────────────────────────────────────────────────────────

async function runScheduled(env: Env): Promise<void> {
  const usernames = env.USERNAMES.split(",").map((u) => u.trim()).filter(Boolean);

  for (const username of usernames) {
    const [entries, seenGuids] = await Promise.all([
      fetchFeedEntries(username),
      getSeenGuids(env.SEEN_REVIEWS, username),
    ]);

    const newEntries = entries.filter((e) => !seenGuids.has(e.guid));

    for (const entry of newEntries) {
      const message = buildMessage(username, entry);
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message);
      seenGuids.add(entry.guid);
    }

    if (newEntries.length > 0) {
      await saveSeenGuids(env.SEEN_REVIEWS, username, seenGuids);
      console.log(`${username}: sent ${newEntries.length} new notification(s)`);
    } else {
      console.log(`${username}: no new entries`);
    }
  }
}

// ── Seed handler ───────────────────────────────────────────────────────────────
// Hit GET /seed once after first deploy to pre-populate KV with all existing
// GUIDs except the latest per user. This prevents a notification burst on the
// first scheduled run, while still surfacing the single most recent entry.

async function runSeed(env: Env): Promise<Response> {
  const usernames = env.USERNAMES.split(",").map((u) => u.trim()).filter(Boolean);
  const results: string[] = [];

  for (const username of usernames) {
    const entries = await fetchFeedEntries(username);
    if (entries.length === 0) {
      results.push(`${username}: no entries found`);
      continue;
    }

    // Keep all GUIDs except the first (most recent) entry — that one will be
    // "discovered" and notified on the next scheduled run.
    const guidsToSeed = new Set(entries.slice(1).map((e) => e.guid));
    await saveSeenGuids(env.SEEN_REVIEWS, username, guidsToSeed);
    results.push(`${username}: seeded ${guidsToSeed.size} GUIDs (1 entry left to notify)`);
    console.log(`Seed: ${username}: ${guidsToSeed.size} GUIDs written to KV`);
  }

  return new Response(results.join("\n"), { status: 200 });
}

// ── Exports ────────────────────────────────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runScheduled(env);
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/seed") return runSeed(env);
    return new Response("Not found", { status: 404 });
  },
};
