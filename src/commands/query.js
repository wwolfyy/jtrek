/**
 * src/commands/query.js implements `jtrek query`, which reads the store without taking any of it.
 *
 * This command writes nothing anywhere: no `work.json`, no `registry.db` and no temporary file.
 * That is its whole reason to exist. `checkout` means taking the work. When one command did both,
 * just looking at the store either took records nobody wanted, or was refused outright because a
 * checkout was already open.
 *
 * It has two ordinary uses:
 *
 *   1. Orientation. A session asks what is open, what is parked, or what belongs to a plan
 *      section, without disturbing whatever is already checked out.
 *   2. Reading a record that the session needs to refer to. Naming a record in a `note`, in prose
 *      or in `related` is only reading it, so it needs no checkout, and this is how the record's
 *      current state is read.
 *
 * Reading a record here is not a way to revise it. A record that already exists is revised only
 * by checking it out, and never by pasting it into `work.json` by hand. The same applies to a
 * record that a `split_from` or `supersedes` will name: `checkin` refuses the link unless that
 * record was checked out. And no amount of reading makes it acceptable to edit `registry.ndjson`
 * by hand, which R1 forbids.
 *
 * Records go to stdout as JSON, and everything else goes to stderr. The output can therefore be
 * piped into `jq`, or straight into a file, without the log lines mixed into it.
 *
 * Usage:
 *   jtrek query --id R-0142 [--id R-0031 …]
 *   jtrek query --query "status = 'open' AND plan = 'plan-surface'"
 */

import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { openStore, selectByIds, selectByQuery } from '../store.js';

const logger = createLogger('jtrek/query');

export const USAGE = `
Usage:
  jtrek query --id R-0142 [--id R-0031 …]     read records by id
  jtrek query --query "status = 'open'"       read records by SQL predicate

Options:
  --count        print how many matched, and no records

Writes nothing. Records go to stdout as JSON; use 'jtrek checkout' to take work.
Only each record's current revision is searched; 'jtrek history' reads the earlier ones.
`.trim();

export function parseArgs(argv) {
  const args = { ids: [], query: null, count: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--id':
        if (!value) throw new UsageError('--id needs a record id, e.g. --id R-0142');
        args.ids.push(value);
        i += 1;
        break;
      case '--query':
        if (!value)
          throw new UsageError('--query needs a SQL predicate, e.g. --query "status = \'open\'"');
        args.query = value;
        i += 1;
        break;
      case '--count':
        args.count = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        return args;
      default:
        throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }

  const selectors = [args.ids.length > 0, args.query !== null].filter(Boolean).length;
  if (selectors === 0) throw new UsageError(`Nothing selected — pass --id or --query.\n\n${USAGE}`);
  if (selectors > 1) throw new UsageError(`Pass either --id or --query, not both.\n\n${USAGE}`);

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

  let records;
  try {
    records = args.ids.length > 0 ? selectByIds(db, args.ids) : selectByQuery(db, args.query);
  } finally {
    db.close();
  }

  if (args.count) {
    process.stdout.write(`${records.length}\n`);
    return 0;
  }

  process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  // An empty result is a legitimate answer, not a failure. A plan section with nothing outstanding
  // and a section nobody has started both produce it, and only the plan document tells them apart.
  logger.info(`${records.length} record(s) matched. Nothing was written.`);
  return 0;
}
