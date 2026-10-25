// Run the roast generator against the real Claude API, with no Telegram or KV.
//
//   npm run roast                                          # built-in sample reviews
//   npm run roast -- "Title, 2026 - ★★★" "Review text"     # one review of your own
//
// ANTHROPIC_API_KEY is read from the environment or from .dev.vars.

import { generateRoast } from "../src/roast.ts";
import type { FeedEntry } from "../src/index.ts";

type Sample = { username: string; title: string; description: string };

const samples: Sample[] = [
  {
    username: "alice",
    title: "Pulp Fiction, 1994 - ★★★★★",
    description: "A masterpiece of cinema. Flawless in every way.",
  },
  {
    // Released 2026: only recognisable with Haiku 5.5's newer knowledge
    username: "bob",
    title: "Project Hail Mary, 2026 - ★★★★",
    description: "Cried at a rock. Twice. Ryan Gosling should only play lonely men in space from now on.",
  },
  {
    // Unknown film: should fall back to roasting the review itself
    username: "carol",
    title: "The Quiet Hours of Margarethe Lind, 2026 - ★★½",
    description: "it was fine i guess. long. lots of fog",
  },
];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Export it or add it to .dev.vars.");
  process.exit(1);
}

const [title, description] = process.argv.slice(2);
const reviews = title && description ? [{ username: "you", title, description }] : samples;

const toEntry = ({ title, description }: Sample): FeedEntry => ({
  guid: title,
  title,
  link: "https://letterboxd.com/",
  hasSpoiler: false,
  description,
});

const results = await Promise.all(
  reviews.map(async (review) => {
    const start = performance.now();
    const roast = await generateRoast(apiKey, review.username, toEntry(review));
    return { review, roast, seconds: (performance.now() - start) / 1000 };
  })
);

for (const { review, roast, seconds } of results) {
  console.log(`\n🎬 ${review.username} watched ${review.title}`);
  console.log(`   “${review.description}”`);
  console.log(`   ${roast ?? "✗ no roast returned (see error above)"}  (${seconds.toFixed(1)}s)`);
}

if (results.some((r) => r.roast === null)) process.exitCode = 1;
