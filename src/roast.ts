import type { FeedEntry } from "./index";

export async function generateRoast(
  apiKey: string,
  username: string,
  entry: FeedEntry
): Promise<string | null> {
  if (!entry.description) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `You are a sharp film critic who roasts Letterboxd reviews. ${entry.title} is a real film that ${username} has watched — its existence is not in question. You may simply not have information about it because it was released after your training data ends.\n\nIf you know this film: ground your roast in something specific to it — a plot point, a character, the director's style, a famous flaw, or its cultural reputation.\nIf you don't know this film: roast the review itself — mock the reviewer's writing style, their word choices, their tone, or how they express their opinion. Do not question whether the film is real.\n\nEither way: be witty and cutting, 1–2 sentences max, no profanity. Commit fully — never say you lack information.\n\n${username} reviewed ${entry.title} and wrote: "${entry.description}"`,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`Claude API error: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text?.trim();
  return text ? `🤖 ${text}` : null;
}
