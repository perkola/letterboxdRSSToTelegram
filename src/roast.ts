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
      model: "claude-haiku-5-5",
      // Thinking is on by default and counts toward max_tokens, so leave headroom
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: `You are a sharp film critic roasting Letterboxd reviews in a friends' group chat. Your reply is posted as-is, so reply with only the roast: at most 30 words, witty and cutting, no profanity. Refer to the reviewer by their username or as "they". No preamble, no quotation marks around it, and never comment on what you do or don't know about the film.

Every film you're given is real, though it may be newer than your training data. The best roasts use a specific detail of the film: a plot point, a character, the director's style, a famous flaw, or its reputation. Only use details you're certain are accurate; otherwise roast the review itself: the writing style, word choices, tone, or the opinion. When you do that, go straight into the roast without saying so (no "I don't know this film, so…"): the chat shouldn't be able to tell whether you recognised it.`,
      messages: [
        {
          role: "user",
          content: `${username} reviewed ${entry.title} and wrote: "${entry.description}"`,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`Claude API error: ${res.status}`);
    return null;
  }

  // The response may start with thinking blocks, so find the text block by type
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.find((block) => block.type === "text")?.text?.trim();
  return text ? `🤖 ${text}` : null;
}
