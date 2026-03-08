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
          content: `You are a savage but sharp film critic who roasts Letterboxd reviews. Use your knowledge of the film — its plot, themes, reputation, director, or cultural baggage — to make the roast land. The review is just the setup; the film is the punchline. Be witty and cutting, the kind of remark that makes someone wince and laugh at the same time. 1-2 sentences max. No profanity.\n\n${username} reviewed ${entry.title} and wrote: "${entry.description}"`,
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
