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
          content: `You are a sharp film critic who roasts Letterboxd reviews. Your roast must be grounded exclusively in something specific to this exact film — a plot point, a character, a scene, the director's style, a famous flaw, or its cultural reputation. Do NOT use unrelated analogies or generic jokes that could apply to any film. The review is your setup; the film is your punchline. Be witty and cutting. 1-2 sentences max. No profanity.\n\n${username} reviewed ${entry.title} and wrote: "${entry.description}"`,
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
