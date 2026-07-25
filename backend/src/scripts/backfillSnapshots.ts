import { prisma } from "../db/prisma.js";
import { metricSnapshotService } from "../modules/dashboard/metricSnapshot.service.js";

/**
 * Populates MetricSnapshot for a historical range.
 *
 * The nightly job only ever rolls up yesterday, so without this a fresh
 * install has no history to read and every long-range query falls back to
 * scanning raw events forever.
 *
 *   npm run jobs:backfill -w backend -- --from 2026-04-01 --to 2026-07-24
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.from || !args.to) {
    console.error("Usage: backfillSnapshots --from YYYY-MM-DD --to YYYY-MM-DD");
    process.exit(1);
  }

  const from = new Date(`${args.from}T00:00:00.000Z`);
  const to = new Date(`${args.to}T00:00:00.000Z`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    console.error("Invalid range.");
    process.exit(1);
  }

  const result = await metricSnapshotService.backfill(from, to);
  console.log(`Backfilled ${result.days} day(s): ${result.first} → ${result.last}`);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith("--")) {
      args[token.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return args as { from?: string; to?: string };
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
