import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateRoast } from "./roast";
import type { FeedEntry } from "./index";

const baseEntry: FeedEntry = {
  guid: "https://letterboxd.com/user/film/review1/",
  title: "Pulp Fiction, 1994 - ★★★★★",
  link: "https://letterboxd.com/user/film/review1/",
  hasSpoiler: false,
  description: "A masterpiece of cinema. Flawless in every way.",
};

describe("generateRoast", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null immediately when description is empty", async () => {
    const entry = { ...baseEntry, description: "" };
    const result = await generateRoast("api-key", "alice", entry);
    expect(result).toBeNull();
  });

  it("calls Claude API and returns roast prefixed with 🤖", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ text: "Calling Pulp Fiction a masterpiece — join the queue, it only has 2 million members." }],
        }),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateRoast("api-key", "alice", baseEntry);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
    });
    expect(result).toBe("🤖 Calling Pulp Fiction a masterpiece — join the queue, it only has 2 million members.");
  });

  it("returns null when Claude API returns a non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateRoast("api-key", "alice", baseEntry);
    expect(result).toBeNull();
  });
});
