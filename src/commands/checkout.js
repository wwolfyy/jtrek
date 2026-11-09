/**
 * src/commands/checkout.js implements `jtrek checkout`, which takes work from the store.
 *
 * The command builds the in-memory index from `registry.ndjson`, runs the caller's selection
 * against it, and writes the current revision of each matching record to `work.json`. The session
 * then edits that file and runs `jtrek checkin`.
 *
 * Checking out means taking the work, and this command always writes `work.json`. Reading the
 * store without taking anything is `jtrek query`, which writes nothing at all. An earlier design
 * had one command do both, told apart by an `--out` flag. That put the burden on the caller to
 * remember which job they were asking for. It also meant that just looking at the store either
 * took work nobody wanted, or was refused outright because a checkout was already open.
 *
 * Usage:
 *   jtrek checkout --id R-0142 [--id R-0031 …]
 *   jtrek checkout --query "status = 'open' AND plan = 'plan-surface'"
 *   jtrek checkout --new                      empty checkout, for adding records only
 *   jtrek checkout --add --id R-0031          add records to the checkout that is already open
 *   jtrek checkout --id R-0142 --force        overwrite an existing work.json
 *
 * A session should check out every record that it means to split or supersede. `checkin` rejects
 * a newly added `split_from` or `supersedes` that names a record not in `work.json`. A session
 * cannot link to a record correctly without having read the record's current state, and the link
 * also writes that record's next revision. `related` needs no checkout, because it writes no
 * revision of the record it names.
 *
 * Taking a record that is already superseded prints a warning on stderr, and the checkout still
 * succeeds. The work on such a record has moved elsewhere, so a revision written against it lands
 * where nobody following the supersession will look. The comment on `warnOnSuperseded` explains
 * why this warns rather than refusing.
 *
 * `--add` copies records into the checkout that is already open, rather than starting a new one.
 * `R-000205` decided that planning is a normal working session, and a planning interview reaches
 * existing records one at a time. Without `--add`, taking each of them would cost a check-in of
 * unfinished work and a fresh checkout. The comment on `addToCheckout` explains why adding is as
 * safe as a checkout.
 *
 * A checkout that took no records writes `example_record` beside the empty `records` array. It is a
 * worked example of a row, for an agent that has no record in front of it. The comment on
 * `EXAMPLE_RECORD` explains why it sits outside the `records` array, and why every one of its
 * values is a placeholder that check-in refuses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { localDate } from '../dates.js';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { noteHistory, openStore, selectByIds, selectByQuery, supersededBy } from '../store.js';

const logger = createLogger('jtrek/checkout');

export const USAGE = `
Usage:
  jtrek checkout --id R-0142 [--id R-0031 …]   check out records by id
  jtrek checkout --query "status = 'open'"     check out records by SQL predicate
  jtrek checkout --new                         empty checkout, for adding records only
  jtrek checkout --add --id R-0031 [--id …]    add records to the checkout already open

Options:
  --force        overwrite an existing work.json

Reading without taking the work is 'jtrek query', which writes nothing.
`.trim();

export function parseArgs(argv, { workPath }) {
  const args = {
    ids: [],
    query: null,
    isNew: false,
    add: false,
    out: workPath,
    force: false,
    help: false,
  };

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
      case '--new':
        args.isNew = true;
        break;
      case '--add':
        args.add = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        return args;
      default:
        throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }

  const selectors = [args.ids.length > 0, args.query !== null, args.isNew].filter(Boolean).length;
  if (selectors === 0)
    throw new UsageError(`Nothing selected — pass --id, --query or --new.\n\n${USAGE}`);
  if (selectors > 1) throw new UsageError(`Pass only one of --id, --query or --new.\n\n${USAGE}`);
  // `--add` takes named records only, because the planning interview it exists for reaches records
  // one at a time. `--force` would mean replacing the open checkout, which is the opposite of adding
  // to it, so it is refused rather than ignored.
  if (args.add && args.ids.length === 0) {
    throw new UsageError(`--add takes records by --id only.\n\n${USAGE}`);
  }
  if (args.add && args.force) {
    throw new UsageError(`--add adds to the open checkout, so --force has nothing to replace.\n\n${USAGE}`);
  }

  return args;
}

/**
 * This is the number of digits jtrek pads a new id to. A new project therefore starts at
 * `R-000001`.
 *
 * The padding is a choice about how ids look, and the schema does not enforce it. `schema.sql`
 * accepts `R-` followed by at least four digits. This number can therefore change without
 * invalidating anything, and a store whose early records have four digits keeps them. `R-000124`
 * is the decision, and it was itself the first record written at this width. The previous width was
 * four, which capped a store at 9,999 records.
 *
 * A store may therefore hold ids of two widths, so nothing may order ids as text. Compared as text,
 * `R-000124` sorts before `R-0123`, and `R-10000` sorts before `R-9999`. Every place that orders
 * ids compares the number after `R-` instead.
 */
export const ID_DIGITS = 6;

/**
 * This returns the next id after the highest one in use, so that adding a record does not mean
 * guessing an id. It is a convenience rather than a safeguard. A new record always starts at
 * `rev: 1`, so an id that collides with an existing record is caught by the primary key anyway.
 *
 * `padStart` pads and never truncates. A store that outgrows `ID_DIGITS` therefore simply gets
 * wider ids and keeps working, and nothing caps the number of records.
 */
export function nextFreeId(db) {
  const row = db.prepare('SELECT MAX(CAST(substr(id, 3) AS INTEGER)) AS n FROM records').get();
  return `R-${String((row.n ?? 0) + 1).padStart(ID_DIGITS, '0')}`;
}

/**
 * This refuses to overwrite an unfinished checkout.
 *
 * `work.json` is gitignored, so an overwritten file cannot be recovered. `checkin` stamps the file
 * with `checked_in` once its records are in the store, and a stamped file is safe to replace. That
 * is what keeps `--force` from becoming a habit. A file with no stamp holds edits that were never
 * recorded anywhere else.
 *
 * The refusal names `jtrek checkin`, and it does not name `--force`. An agent that meets this
 * message is looking for a way past it, and `--force` discards exactly the work that the refusal
 * protects (`R-0013`). The flag stays documented in `--help` for a person who means to discard the
 * work.
 */
export function assertSafeToOverwrite(outPath, force) {
  if (!fs.existsSync(outPath) || force) return;

  let checkedIn = null;
  try {
    checkedIn = JSON.parse(fs.readFileSync(outPath, 'utf8')).checked_in ?? null;
  } catch {
    logger.warn(`${outPath} exists but is not readable JSON — treating it as unfinished work.`);
  }

  if (checkedIn) {
    logger.info(`Replacing the checkout that was checked in on ${checkedIn}.`);
    return;
  }

  throw new Error(
    `${outPath} holds an unfinished checkout — it has no 'checked_in' stamp, and it is ` +
      `gitignored, so overwriting it loses that work for good. Run 'jtrek checkin' first.`
  );
}

/**
 * This warns when a record being taken has already been superseded.
 *
 * A superseded record is one whose work moved somewhere else. `schema.sql` says the same of the
 * `supersedes` field: the records a row replaces are finished with. Revising one is usually a
 * mistake, because the reasoning then lands where a reader following the supersession will never
 * look.
 *
 * This warns rather than refusing, and the reason is narrow. The one legitimate case is a
 * corrective revision, which annotates a record that is already superseded. That is R1's
 * instruction to fix a mistake by adding the next revision. A refusal would need `--force` to get
 * past it, and this command already uses that flag for discarding an unfinished checkout. Revision
 * 2 of `R-0073` judged that use to have the stronger claim on the flag.
 *
 * Establishing a supersession is not a case that this has to allow for, and revision 2 of `R-0073`
 * corrected revision 1 on this point. `jtrek checkin` requires the superseded record to be in the
 * checkout, and it is that check-in which writes the `superseded` outcome. At the moment the record
 * is taken, its current row is therefore not superseded at all, and no warning fires.
 *
 * Nothing else catches a misaimed revision. `jtrek checkin` cannot tell that a revision was aimed
 * at the wrong record. `jtrek query` is where the outcome would be read, and an agent reaching for
 * `checkout` has usually skipped it. `registry.md` shows the outcome in a column that nobody
 * consults in the middle of the loop.
 */
export function warnOnSuperseded(db, records) {
  for (const record of records) {
    if (record.outcome !== 'superseded') continue;
    const successors = supersededBy(db, record.id);
    const replacedBy =
      successors.length > 0
        ? `${successors.join(', ')} replaced it`
        : 'no record in the store names it in a supersedes list, so what replaced it is unrecorded';
    logger.warn(
      `${record.id} is superseded — ${replacedBy}. Its work moved, so a revision written here ` +
        `lands where a reader following the supersession will not look. Revise it only to correct ` +
        `its own history; write anything else onto the record that replaced it.`
    );
  }
}

/**
 * This is the worked example written beside `next_free_id` when a checkout takes no records.
 *
 * It exists because the two kinds of checkout leave an agent in very different positions. `--id`
 * writes a record's whole current revision into `work.json`, so an agent revising that record edits
 * a shape that is already in front of it. `--new` writes an empty array, so an agent adding the
 * session's first record has to produce a sixteen-field object from memory. `R-0098` shipped
 * `docs/schema.md`, which closes the half of that gap that comes from not knowing what the fields
 * are. This example closes the other half, which is retyping a shape the tool can simply hand over.
 *
 * The example sits beside `records`, and never inside it. `jtrek checkin` treats every entry in
 * that array as a record to write. An example placed there would therefore be checked into an
 * append-only store as a real row, unless the agent deleted it first. An agent that does not
 * understand the fields is exactly the agent that would not realise it had to. `stampCheckedIn`
 * rebuilds the file as `{ ...existing }` and overwrites only `records`, so a key beside `records`
 * survives check-in untouched and is never read as a record. `R-000128` is the record.
 *
 * Every value is a placeholder that check-in refuses, and that is what makes a filled-in example
 * safe. The choice looked like a trade-off. Nulls show the shape, but say nothing about what the
 * enumerated fields accept. Filled-in values show both, but might be copied in unedited. Five
 * independent checks remove that trade-off. `id` and `ts` fail their CHECK constraints in
 * `schema.sql`. `type` and `status` fail theirs, because they list their permitted values rather
 * than holding one of them. `detail_ref` names a prose file that does not exist, which
 * `jtrek checkin` refuses before it writes anything. A verbatim copy therefore fails loudly and
 * leaves the registry untouched, so the values are free to describe the fields rather than merely
 * fill them.
 *
 * A field that may be null is written as `null`, which is the convention that an `--id` checkout
 * already uses for the fields a record does not use. `docs/schema.md` says what each field means
 * and which fields are required. This example shows the shape, rather than restating that document.
 *
 * `chain` is the one field here that is null for a different reason. It is `NOT NULL` in the
 * schema, so a null would normally be wrong. However, no session writes it. `jtrek checkin`
 * computes it from the row's contents and its position as it appends, in the same way it computes
 * `rev`. Showing it as null, with the comment beside it, tells a reader that the field exists and
 * is not theirs to fill in.
 */
export const EXAMPLE_RECORD = {
  id: 'R-XXXXXX (take the value of next_free_id above)',
  rev: 1,
  ts: 'YYYY-MM-DD (the date this revision is written)',
  type: 'one of: task, decision, bug, change, question, requirement',
  status: 'one of: open, in-progress, planned, done, abandoned, deferred',
  outcome: null,
  title: 'One line saying what the item is.',
  statement: null, // a requirement's exact text; required on a requirement, refused on any other type
  feature: null,   // the group of requirements a requirement belongs to; the same rule applies
  plan: 'the slug of the plan section this belongs to, e.g. plan-surface, or null',
  detail_ref: 'records/R-XXXXXX.md (write the file before checking in)',
  note: 'Why this revision exists, written for a session that was not here.',
  supersedes: null,
  split_from: null,
  related: null,   // or {"depends_on": [...], "related_to": [...], "implements": [...]}
  files: null,
  source_ref: null,
  chain: null,     // jtrek writes this as it appends. A value put here is ignored.
};

/**
 * Returns `records` with each record's earlier notes attached as `_note_history`.
 *
 * The earlier notes travel with the checkout, rather than being fetched by whoever remembers to. A
 * note says why one revision exists, so the reasoning behind a record is spread across its
 * revisions. A rule telling the session to go and query the rest would fail silently, because the
 * record in hand looks complete without them. `jtrek checkin` strips this field again, so editing
 * it changes nothing.
 */
function withNoteHistory(db, records) {
  return records.map((record) => {
    const history = noteHistory(db, record.id, record.rev);
    return history.length > 0 ? { ...record, _note_history: history } : record;
  });
}

/**
 * Reads the checkout that `--add` adds to, and refuses when there is no open checkout to add to.
 *
 * A checkout is open when `work.json` exists and carries no `checked_in` stamp. A stamped file is
 * refused as well as a missing one, because its records are already in the store. Adding to it
 * would reopen a finished checkout, whose records would then be checked in a second time.
 */
function readOpenCheckout(workPath) {
  if (!fs.existsSync(workPath)) {
    throw new Error(
      `No checkout is open at ${workPath}, so there is nothing to add to. Start one with ` +
        `'jtrek checkout --id <id>' or 'jtrek checkout --new'.`
    );
  }
  let checkout;
  try {
    checkout = JSON.parse(fs.readFileSync(workPath, 'utf8'));
  } catch (error) {
    logger.error(`${workPath} is not valid JSON.`);
    throw new Error(`${workPath} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (checkout === null || typeof checkout !== 'object' || !Array.isArray(checkout.records)) {
    throw new Error(`${workPath} must be an object holding a 'records' array.`);
  }
  if (checkout.checked_in) {
    throw new Error(
      `The checkout at ${workPath} was checked in on ${checkout.checked_in}, so there is no open ` +
        `checkout to add to. Start one with 'jtrek checkout --id <id>'.`
    );
  }
  return checkout;
}

/**
 * Copies records from the store into the checkout that is already open, and returns the records it
 * copied.
 *
 * Adding is as safe as a checkout, for the reason `jtrek plan take` was safe before it retired.
 * Each record arrives as its current row, which is exactly what `--id` would have written, and
 * `jtrek checkin` computes the next revision from the registry rather than from this file.
 * Nothing the session already wrote into the file is touched. A record that the file already holds
 * is not copied again, because its entry may hold this session's edits and a fresh copy would
 * replace them.
 */
export function addToCheckout(workPath, db, ids) {
  const checkout = readOpenCheckout(workPath);
  const held = new Set(checkout.records.map((record) => record?.id));

  const wanted = [...new Set(ids)].filter((id) => {
    if (!held.has(id)) return true;
    logger.info(`${id} is already in the checkout, so it was not copied again.`);
    return false;
  });
  const records = withNoteHistory(db, selectByIds(db, wanted));
  if (records.length === 0) return records;

  checkout.records.push(...records);
  checkout.selector = `${checkout.selector ?? ''}; --add ${wanted.join(', ')}`;
  fs.writeFileSync(workPath, `${JSON.stringify(checkout, null, 2)}\n`);
  logger.info(`Added ${records.length} record(s) to the open checkout at ${workPath}.`);
  return records;
}

export function run(argv, store) {
  const args = parseArgs(argv, store);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (!args.add) assertSafeToOverwrite(args.out, args.force);

  const { db } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });
  try {
    if (args.add) {
      const added = addToCheckout(args.out, db, args.ids);
      warnOnSuperseded(db, added);
      return 0;
    }

    let records = [];
    if (args.ids.length > 0) records = selectByIds(db, args.ids);
    else if (args.query) records = selectByQuery(db, args.query);
    records = withNoteHistory(db, records);

    // The example is written whenever the checkout took no records, rather than only for --new. A
    // query that matched nothing leaves an agent in the same position as --new. A checkout that did
    // take records puts a real record in front of the agent, which is a better example than this.
    const checkout = {
      checked_out: localDate(),
      selector: args.isNew ? '--new' : (args.query ?? args.ids.join(', ')),
      next_free_id: nextFreeId(db),
      ...(records.length === 0 ? { example_record: EXAMPLE_RECORD } : {}),
      records,
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(checkout, null, 2)}\n`);
    // The example is named here because nothing else would name it. R-000128 is about an agent
    // that does not know what a record's fields are, and such an agent has no reason to go looking
    // for a key it has never heard of.
    logger.info(
      `Checked out ${records.length} record(s) to ${args.out}. ` +
        `Next free id is ${checkout.next_free_id}.` +
        (records.length === 0
          ? ` No records were taken, so 'example_record' beside them shows a row's shape — copy it ` +
            `into 'records' and replace every value.`
          : '')
    );
    // The warning comes after the write and after the count, deliberately. The checkout succeeded,
    // so the last line the reader sees should be the one saying what is wrong with what was taken.
    warnOnSuperseded(db, records);
  } finally {
    db.close();
  }

  return 0;
}
