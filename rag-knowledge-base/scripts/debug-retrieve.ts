// One-off debug: run both strategies for a single question and dump the top
// chunks so we can see WHY a miss happened.
//
// Usage:
//   npx tsx --env-file=.env scripts/debug-retrieve.ts "What is AuroraCare+"

import { prisma } from "@/lib/prisma";
import { retrieve } from "@/lib/rag/retrieve";
import { hybridRetrieve } from "@/lib/rag/hybrid";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("Usage: tsx scripts/debug-retrieve.ts <question>");
    process.exit(1);
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  if (users.length !== 1) {
    console.error("Expected exactly one user in DB for this debug script");
    process.exit(1);
  }
  const userId = users[0].id;

  console.log(`Query: "${query}"`);
  console.log(`User: ${users[0].email}\n`);

  const [dense, hybrid] = await Promise.all([
    retrieve(userId, query, { k: 5 }),
    hybridRetrieve(userId, query, { k: 5 }),
  ]);

  for (const [name, results] of [
    ["dense-only", dense],
    ["hybrid-rrf", hybrid],
  ] as const) {
    console.log(`=== ${name} ===`);
    results.forEach((r, i) => {
      const preview = r.content.replace(/\s+/g, " ").slice(0, 160);
      console.log(
        `  #${i + 1} sim=${r.similarity.toFixed(3)} idx=${r.index} — ${preview}`,
      );
    });
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
