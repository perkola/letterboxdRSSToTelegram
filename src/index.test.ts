import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, { parseFeed, buildMessage, runScheduled, runSeed, FeedEntry } from "./index";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => Promise.resolve(void store.set(key, value)),
  };
}

function makeEnv(kv: ReturnType<typeof makeMockKV>, usernames = "testuser") {
  return {
    SEEN_REVIEWS: kv as unknown as KVNamespace,
    USERNAMES: usernames,
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "test-chat",
    SEED_SECRET: "test-secret",
  };
}

function makeRssXml(items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:letterboxd="https://a.letterboxd.com/ns/1.0/">
  <channel>
    <title>Test Feed</title>
    ${items.join("\n    ")}
  </channel>
</rss>`;
}

function makeItem(guid: string, title: string, link: string, hasSpoiler = false, description = ""): string {
  const spoilerTag = hasSpoiler
    ? "<letterboxd:spoilerWarning>This review may contain spoilers.</letterboxd:spoilerWarning>"
    : "";
  const descTag = description ? `<description><![CDATA[${description}]]></description>` : "";
  return `<item>
      <guid>${guid}</guid>
      <title>${title}</title>
      <link>${link}</link>
      ${spoilerTag}
      ${descTag}
    </item>`;
}

// ── parseFeed ───────────────────────────────────────────────────────────────

describe("parseFeed", () => {
  it("parses a valid feed entry with rating, spoiler flag, and description", () => {
    const xml = makeRssXml([
      makeItem(
        "https://letterboxd.com/user/film/review1/",
        "The Matrix, 1999 - ★★★★",
        "https://letterboxd.com/user/film/review1/",
        true,
        "<p>Watched 01 Jan 2025. <br/> A mind-bending sci-fi classic.</p>"
      ),
    ]);
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].guid).toBe("https://letterboxd.com/user/film/review1/");
    expect(entries[0].title).toBe("The Matrix, 1999 - ★★★★");
    expect(entries[0].link).toBe("https://letterboxd.com/user/film/review1/");
    expect(entries[0].hasSpoiler).toBe(true);
    expect(entries[0].description).toBe("A mind-bending sci-fi classic.");
  });

  it("parses a feed entry with no spoiler warning and no description", () => {
    const xml = makeRssXml([
      makeItem(
        "https://letterboxd.com/user/film/review2/",
        "Inception, 2010 - ★★★★★",
        "https://letterboxd.com/user/film/review2/",
        false
      ),
    ]);
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].hasSpoiler).toBe(false);
    expect(entries[0].description).toBe("");
  });

  it("returns empty array for empty channel", () => {
    const xml = makeRssXml([]);
    const entries = parseFeed(xml);
    expect(entries).toEqual([]);
  });

  it("handles single-item feed correctly (array wrapping)", () => {
    const xml = makeRssXml([makeItem("guid1", "Film A", "https://letterboxd.com/a/")]);
    const entries = parseFeed(xml);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
  });

  it("handles multiple items", () => {
    const xml = makeRssXml([
      makeItem("guid1", "Film A", "https://letterboxd.com/a/"),
      makeItem("guid2", "Film B", "https://letterboxd.com/b/"),
    ]);
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0].guid).toBe("guid1");
    expect(entries[1].guid).toBe("guid2");
  });
});

// ── buildMessage ────────────────────────────────────────────────────────────

describe("buildMessage", () => {
  const baseEntry: FeedEntry = {
    guid: "https://letterboxd.com/user/film/review1/",
    title: "The Matrix, 1999 - ★★★★",
    link: "https://letterboxd.com/user/film/review1/",
    hasSpoiler: false,
    description: "",
  };

  it("formats correctly without spoiler warning", () => {
    const msg = buildMessage("alice", baseEntry);
    expect(msg).toBe(
      "🎬 alice watched The Matrix, 1999 - ★★★★\nhttps://letterboxd.com/user/film/review1/"
    );
  });

  it("formats correctly with spoiler warning", () => {
    const entry = { ...baseEntry, hasSpoiler: true };
    const msg = buildMessage("alice", entry);
    expect(msg).toBe(
      "🎬 alice watched The Matrix, 1999 - ★★★★ ⚠️ Spoiler\nhttps://letterboxd.com/user/film/review1/"
    );
  });
});

// ── runScheduled ────────────────────────────────────────────────────────────

describe("runScheduled", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Telegram notification for new entries and saves GUIDs to KV", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv, "alice");
    const feedXml = makeRssXml([makeItem("guid1", "Film A", "https://letterboxd.com/a/")]);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { message_id: 1 } }) } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    await runScheduled(env as any);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [telegramUrl, telegramInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(telegramUrl).toContain("api.telegram.org");
    const body = JSON.parse(telegramInit.body as string);
    expect(body.text).toContain("alice");
    expect(body.text).toContain("Film A");

    const stored = await kv.get("seen:alice");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toContain("guid1");
  });

  it("skips already-seen entries and does not call Telegram", async () => {
    const kv = makeMockKV();
    await kv.put("seen:alice", JSON.stringify(["guid1"]));
    const env = makeEnv(kv, "alice");
    const feedXml = makeRssXml([makeItem("guid1", "Film A", "https://letterboxd.com/a/")]);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    await runScheduled(env as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends roast as a threaded reply when ANTHROPIC_API_KEY is set and entry has a description", async () => {
    const kv = makeMockKV();
    const env = { ...makeEnv(kv, "alice"), ANTHROPIC_API_KEY: "test-anthropic-key" };
    const feedXml = makeRssXml([
      makeItem("guid1", "Pulp Fiction, 1994 - ★★★★★", "https://letterboxd.com/a/", false, "<p>Watched 01 Jan 2025. A masterpiece.</p>"),
    ]);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { message_id: 42 } }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ content: [{ text: "Bold choice." }] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { message_id: 43 } }) } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    await runScheduled(env as any);

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const [claudeUrl] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(claudeUrl).toBe("https://api.anthropic.com/v1/messages");
    const [, roastInit] = mockFetch.mock.calls[3] as [string, RequestInit];
    const roastBody = JSON.parse(roastInit.body as string);
    expect(roastBody.reply_to_message_id).toBe(42);
    expect(roastBody.text).toBe("🤖 Bold choice.");
  });

  it("continues processing other users when one feed fetch throws", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv, "alice,bob");
    const feedXml = makeRssXml([makeItem("guid-bob", "Film B", "https://letterboxd.com/b/")]);

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { message_id: 1 } }) } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    await runScheduled(env as any);

    const [telegramUrl, telegramInit] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(telegramUrl).toContain("api.telegram.org");
    const body = JSON.parse(telegramInit.body as string);
    expect(body.text).toContain("bob");
  });
});

// ── runSeed ─────────────────────────────────────────────────────────────────

describe("runSeed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds all GUIDs except the latest and returns confirmation text", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv, "alice");
    const feedXml = makeRssXml([
      makeItem("guid-latest", "Film Latest", "https://letterboxd.com/latest/"),
      makeItem("guid-old1", "Film Old 1", "https://letterboxd.com/old1/"),
      makeItem("guid-old2", "Film Old 2", "https://letterboxd.com/old2/"),
    ]);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const response = await runSeed(env as any);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("alice");
    expect(text).toContain("2 GUIDs");

    const stored = await kv.get("seen:alice");
    const guids = JSON.parse(stored!);
    expect(guids).toContain("guid-old1");
    expect(guids).toContain("guid-old2");
    expect(guids).not.toContain("guid-latest");
  });
});

// ── /seed auth ──────────────────────────────────────────────────────────────

describe("fetch handler /seed auth", () => {
  it("returns 401 when secret is missing or wrong", async () => {
    const env = makeEnv(makeMockKV());

    const noSecret = await handler.fetch(new Request("https://example.com/seed"), env as any, {} as any);
    expect(noSecret.status).toBe(401);

    const wrongSecret = await handler.fetch(new Request("https://example.com/seed?secret=wrong"), env as any, {} as any);
    expect(wrongSecret.status).toBe(401);
  });
});
