/**
 * src/commands/history.js implements `jtrek history`, which reads every revision of a record
 * without taking it.
 *
 * This command writes nothing anywhere, for the same reason that `jtrek query` writes nothing.
 * Reading is not taking, so it runs while a checkout is open.
 *
 * It exists because a record's reasoning is often spread over several revisions, and its current
 * row states only the last of them. `jtrek query` searches current rows only. `jtrek view` shows
 * every revision, but in a browser, which a session in a terminal cannot open. `jtrek checkout`
 * returns the earlier notes, but checking out takes the work. A session that needed the history
 * therefore read `registry.db` with raw SQL, which went around the rule that the store is read
 * through the tool (`R-000149`).
 *
 * It is a separate command rather than a flag on `jtrek query`. Every predicate a session writes
 * today is about each record's current row. A flag that widened the search to every revision
 * would make the same predicate mean two different things, depending on whether the flag was
 * passed, and nothing in the predicate would show which. This command selects by id only, so there
 * is no predicate whose meaning could change.
 *
 * Revisions go to stdout as one JSON array, grouped by id in the order the ids were given, with
 * each record's revisions oldest first. Everything else goes to stderr, so the output can be piped
 * into `jq`.
 *
 * Usage:
 *   jtrek history --id R-0142 [--id R-0031 …]
 */

import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { openStore, selectHistory } from '../store.js';

const logger = createLogger('jtrek/history');

export const USAGE = `
Usage:
  jtrek history --id R-0142 [--id R-0031 …]   read every revision of these records

Writes nothing. Revisions go to stdout as JSON, oldest first. 'jtrek query' searches only
each record's current revision; this reads the earlier ones too.
`.trim();

export function parseArgs(argv) {
  const args = { ids: [], help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--id':
        if (!value) throw new UsageError('--id needs a record id, e.g. --id R-0142');
        args.ids.push(value);
        i += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        return args;
      default:
        throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }

  if (args.ids.length === 0) throw new UsageError(`Nothing selected — pass --id.\n\n${USAGE}`);
  return args;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const { db } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });

  let revisions;
  try {
    revisions = selectHistory(db, args.ids);
  } finally {
    db.close();
  }

  process.stdout.write(`${JSON.stringify(revisions, null, 2)}\n`);
  logger.info(`${revisions.length} revision(s) of ${args.ids.length} record(s). Nothing was written.`);
  return 0;
}
