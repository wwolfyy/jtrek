/**
 * src/commands/db.js implements `jtrek db`, which regenerates `registry.db`, an SQLite copy of
 * the store for browsing.
 *
 * `jtrek build` already writes this file as a side effect of regenerating `registry.md`. This
 * command exists so that a person can refresh only the database, for example after a `git pull` or
 * to look something up. It does so without rewriting a generated markdown file that the person did
 * not mean to touch and would then see in `git status`.
 *
 * The file is a copy for reading, and not a store. `registry.ndjson` is the only source of truth.
 * This command reads it, builds the same in-memory index that every other command builds, and
 * writes that index to disk. Nothing may read the `.db` file back into the tooling. The moment
 * something did, the store would have two sources of truth, and the append-only design would stop
 * meaning anything. Deleting `registry.db` at any time is safe, because it is gitignored and one
 * command recreates it.
 *
 * Because it rebuilds from scratch, the command also validates the whole store. The schema checks
 * every row as it is loaded, so a run that succeeds means that the store loads cleanly.
 *
 * Usage:
 *   jtrek db                    regenerate <store>/registry.db
 *   jtrek db --quiet            print nothing on success (exit status still tells you)
 */

import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { currentRecords, openStore, writeDatabase } from '../store.js';

const logger = createLogger('jtrek/db');

export const USAGE = 'Usage: jtrek db [--quiet]';

export function parseArgs(argv, { registryDbPath }) {
  const args = { out: registryDbPath, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--quiet' || flag === '-q') {
      args.quiet = true;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
      return args;
    } else {
      throw new UsageError(`Unknown argument '${flag}'. ${USAGE}`);
    }
  }
  return args;
}

export function run(argv, store) {
  const args = parseArgs(argv, store);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // allowMissing is set because an empty store is a legitimate thing to browse. It is what the
  // registry looked like on its first day, and failing here would be less useful than writing an
  // empty file.
  const { db } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });
  let count;
  try {
    count = currentRecords(db).length;
    writeDatabase(db, args.out);
  } finally {
    db.close();
  }

  if (!args.quiet) {
    logger.info(`Wrote ${args.out} — ${count} record(s). Query the 'current_records' view.`);
  }

  return 0;
}
