import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFeed, buildMessage, runScheduled, runSeed, FeedEntry } from "./index";

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

function makeItem(guid: string, title: string, link: string, hasSpoiler = false): string {
  const spoilerTag = hasSpoiler
    ? "<letterboxd:spoilerWarning>This review may contain spoilers.</letterboxd:spoilerWarning>"
    : "";
  return `<item>
      <guid>${guid}</guid>
      <title>${title}</title>
      <link>${link}</link>
      ${spoilerTag}
    </item>`;
}

// ── parseFeed ───────────────────────────────────────────────────────────────

describe("parseFeed", () => {
  it("parses a valid feed entry with rating and spoiler flag", () => {
    const xml = makeRssXml([
      makeItem(
        "https://letterboxd.com/user/film/review1/",
        "The Matrix, 1999 - ★★★★",
        "https://letterboxd.com/user/film/review1/",
        true
      ),
    ]);
    const entries = parseFeed(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].guid).toBe("https://letterboxd.com/user/film/review1/");
    expect(entries[0].title).toBe("The Matrix, 1999 - ★★★★");
    expect(entries[0].link).toBe("https://letterboxd.com/user/film/review1/");
    expect(entries[0].hasSpoiler).toBe(true);
  });

  it("parses a feed entry with no spoiler warning", () => {
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
      .mockResolvedValueOnce({ ok: true } as unknown as Response);
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

  it("continues processing other users when one feed fetch throws", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv, "alice,bob");
    const feedXml = makeRssXml([makeItem("guid-bob", "Film B", "https://letterboxd.com/b/")]);

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feedXml) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true } as unknown as Response);
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
