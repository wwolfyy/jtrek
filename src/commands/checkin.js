/**
 * src/commands/checkin.js implements `jtrek checkin`, which is step 3 of the loop.
 *
 * The command reads `work.json` and works out which of its records actually changed. It then
 * inserts the whole store and the changed records into a fresh database built from `schema.sql`,
 * and rolls that transaction back, so that the schema's constraints have judged the result before
 * anything is written. Only after that does it append the changed records to `registry.ndjson`,
 * each at the revision after its current one.
 *
 * The command writes all of the batch or none of it. A failure in any check, for any record,
 * stops the run before the registry is touched.
 *
 * Several rules are checked here in JavaScript, and most of them are here because `schema.sql`
 * cannot express them. A `CHECK` constraint binds one row at a time, and it cannot compare a row
 * with another row, iterate the keys of a JSON object, or look at the filesystem. The rules are
 * these, and each function below explains its own:
 *   1. A newly added `split_from` or `supersedes` must name a record that is in `work.json`, and
 *      that record must itself be written in the same check-in. If nothing else about it changed,
 *      it therefore needs a `note`. `related` is deliberately not among these links, because it
 *      writes no revision of the record it names (`checkReferences`).
 *   2. A `note` may not contain the whole of the previous revision's note
 *      (`checkNoteIsOwnReason`).
 *   3. The kind of each `related` group must be one that the vocabulary holds (`R-000151`).
 *      A kind outside the list is stored without complaint and then matches no search that asks
 *      for it (`checkRelationKinds`).
 *   4. A record that is already `deferred` takes no revision except one that changes its status,
 *      and the revision that parks a record must give it a prose file (`R-0062`,
 *      `checkDeferredRule`).
 *   5. A prose file must belong to the record that names it, and a prose file in `records/` must
 *      be named for that record (`checkProseFileIsOwned`, `checkProseFileNamedForRecord`).
 *   6. The file that `detail_ref` names must exist (`checkDetailRefs`).
 *
 * Two further rules are enforced by `schema.sql` as well: an `in-progress` row must carry a
 * `note`, and every row must carry a `detail_ref`. They are checked here first only so that the
 * failure tells the session what to do, rather than naming a constraint
 * (`checkInProgressNotes`, `checkProseFileRequired`).
 *
 * `rev` is computed here rather than taken from `work.json`, and that is what makes recovery from a
 * git merge conflict work. When two branches both append a revision of the same record, the
 * session takes the incoming registry whole and runs this command again. `work.json` still holds
 * what the session meant to write, and the revision number is recomputed from the registry as it
 * now stands.
 *
 * `chain` is computed here too, for the same reason. Each row's chain value covers the row before
 * it in the file. The value can therefore be settled only once the rows' final contents and their
 * position are both known, which is after `planWrites` has run and immediately before the append.
 * The merge recovery described above works unchanged. The incoming registry becomes the rows that
 * this check-in follows, so running the command again chains the session's rows onto the other
 * branch's rows without anybody doing any arithmetic.
 *
 * Usage:
 *   jtrek checkin [--in <path>]     (default: <store>/work.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { localDate } from '../dates.js';
import { createLogger } from '../logger.js';
import { misnamedProse } from '../discovery.js';
import {
  CHAIN_FIELD,
  FIELDS,
  RELATION_KINDS,
  applyChain,
  createDatabase,
  currentRecords,
  insertRecords,
  openStore,
  serializeHeader,
  serializeRecord,
  stripTransient,
} from '../store.js';

const logger = createLogger('jtrek/checkin');

export const USAGE = 'Usage: jtrek checkin [--in <path>]   (default: <store>/work.json)';

/**
 * These are the fields that decide whether a record changed. `id` is left out because it
 * identifies the record. `rev`, `ts` and `chain` are left out because this command computes them,
 * rather than a session choosing them.
 *
 * `chain` is excluded for the same reason as `rev`. A checkout hands back the chain value that the
 * stored row carries, and check-in recomputes it from the position the new row will take. The
 * value in `work.json` is therefore never the reason a record counts as changed. If it were
 * compared, a session that edited it would write a revision whose only difference was a value
 * that nobody is meant to set.
 */
const COMPARED_FIELDS = FIELDS.filter(
  (field) => !['id', 'rev', 'ts', CHAIN_FIELD].includes(field)
);

export function parseArgs(argv, { workPath }) {
  const args = { in: workPath, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--in') {
      if (!argv[i + 1]) throw new UsageError('--in needs a path');
      args.in = path.resolve(argv[i + 1]);
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
      return args;
    } else {
      throw new UsageError(`Unknown argument '${flag}'. ${USAGE}`);
    }
  }
  return args;
}

/** The checkout file may hold the object `checkout` writes, or a bare array of records. */
export function readWorkFile(workPath) {
  let text;
  try {
    text = fs.readFileSync(workPath, 'utf8');
  } catch (error) {
    logger.error(`Cannot read the checkout file at ${workPath}. Run 'jtrek checkout' first.`);
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.error(`${workPath} is not valid JSON.`);
    throw new Error(`${workPath} is not valid JSON: ${error.message}`, { cause: error });
  }

  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) {
    throw new Error(`${workPath} must hold a 'records' array (or be one).`);
  }
  // The fields that `jtrek checkout` added for context are dropped here, before anything
  // validates the record. `assertRecord` refuses a key it does not know, and that refusal is worth
  // keeping because it catches a misspelt field name.
  return records.map(stripTransient);
}

/** Two records count as unchanged if every field except `id`, `rev`, `ts` and `chain` matches. */
export function isUnmodified(candidate, base) {
  return COMPARED_FIELDS.every(
    (field) => JSON.stringify(candidate[field] ?? null) === JSON.stringify(base[field] ?? null)
  );
}

/**
 * This decides what each record in the checkout becomes. It becomes a new record at `rev: 1`,
 * or the next revision of an existing record, or nothing at all if it matches the current row.
 */
export function planWrites(workRecords, currentById) {
  const writes = [];
  const dropped = [];

  for (const record of workRecords) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error(`Every record in the checkout needs an 'id'. Got: ${JSON.stringify(record)}`);
    }

    const base = currentById.get(record.id);
    if (base && isUnmodified(record, base)) {
      dropped.push(record);
      continue;
    }

    // `ts` is always stamped here, and a value in the checkout is ignored, as `rev` is. `jtrek
    // checkout` copies the previous revision's `ts` into `work.json`. When a value found there was
    // kept, every revision of an existing record carried the date of the revision before it rather
    // than the date it was written. `R-000369` records that defect.
    writes.push({
      ...record,
      rev: base ? base.rev + 1 : 1,
      ts: localDate(),
      isNew: !base,
    });
  }

  return { writes, dropped };
}

/**
 * This refuses a note that contains the whole of the previous revision's note, wherever it sits.
 *
 * A `note` answers why this particular revision exists, so each revision gives one reason of its
 * own. A session that appends to the previous note instead produces a field that repeats itself
 * and grows without limit. By 2026-08-23 one row held 4,706 characters, in a column that
 * `rules/schema.md` describes as one line.
 *
 * The rule is enforced here, rather than only written down, because the store teaches by example
 * and its examples were wrong. On 2026-08-17 notes written one reason per revision outnumbered
 * cumulative notes six to one, and on 2026-08-21 they did so seven to four. An agent then read a
 * handful of cumulative notes and took them for the house style. Over the next two days the
 * cumulative form became the majority, and 28 of the 36 offending rows came from one session that
 * had the written rule in front of it. A single worked example loses to a hundred examples that
 * contradict it, so the check has to refuse the write. `R-0064` is the record.
 *
 * The check catches duplication of the text itself, and it does not catch imitation. A note that
 * restates the previous note in new words passes. That limit is intended, because it means the
 * mechanical test never refuses a note that is actually its own reason. A note that quotes only
 * part of the previous note also passes, because a revision sometimes has to name what it corrects.
 *
 * The check used to refuse only a note that began with the previous note. A note that gave its own
 * reason first and then copied the previous note after it, often after words such as "the previous
 * revision's note follows", repeated the history in the same way and passed. By 2026-09-27, 110
 * current rows had been written in that form. `R-000210` records it.
 */
export function checkNoteIsOwnReason(writes, currentById) {
  const problems = [];

  for (const record of writes) {
    const base = currentById.get(record.id);
    const previous = (base?.note ?? '').trim();
    const note = (record.note ?? '').trim();
    const at = previous && note ? note.indexOf(previous) : -1;
    if (at === -1) continue;

    // What the session added may sit before the copy, after it, or on both sides.
    const added = [note.slice(0, at), note.slice(at + previous.length)]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' … ');
    problems.push(
      `${record.id}: 'note' contains the whole of rev ${base.rev}'s note. A note says why THIS ` +
        `revision exists, not the history. The earlier reasons are already in the store, and ` +
        `'jtrek checkout' hands them back in '_note_history'.` +
        (added ? ` Keep only what you added: "${added.slice(0, 120)}${added.length > 120 ? '…' : ''}"` : '')
    );
  }

  if (problems.length > 0) {
    throw new Error(`Cumulative note refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This enforces the rules about `split_from` and `supersedes` that SQL cannot express.
 *
 * The rules are checked against the records in the checkout only, and that is deliberate. A
 * session that references a record it did not check out should have checked that record out
 * first, for two reasons. A session cannot reference a record correctly without having read the
 * record's current state. And both kinds of reference require this check-in to write the target's
 * next revision in any case.
 *
 * Only a link that this revision adds is checked. `split_from` and `supersedes` are ordinary
 * columns, so every later revision of a record carries forward whatever the record linked to,
 * however long ago. If those carried links were checked again, a record that once superseded
 * another could never take an unrelated revision without bringing the target back into the
 * checkout and writing it a revision that says nothing. That burden would last forever, because
 * the log is append-only. The rule exists because creating a link changes the target, and carrying
 * an existing link forward does not change it. `R-0071` is the record.
 *
 * A link from a record to itself is refused whether it is new or carried. A carried one cannot
 * exist, because it would have been refused when it was created. Checking it therefore costs
 * nothing, and the guarantee is simpler to state.
 *
 * `related` is exempt, and the exemption comes from how the check is built rather than from a rule
 * of its own. This comment used to say that such a column would need an exemption if one were ever
 * added, and `R-000138` added `related` on 2026-09-24. The exemption is that `related` is never put
 * into `targets` below. Its reason is the same one that scopes the rule in the first place. A
 * referenced record must be in the checkout because the reference writes that record's next
 * revision. A `related` entry writes no revision of the record it names and changes nothing about
 * it, so that reason does not apply. The rule has been scoped correctly, rather than given a hole.
 *
 * Whether the ids in `related` exist is still checked, but not here. The `references` group of
 * `jtrek check` verifies every one of them against the whole store. That is the right place for a
 * link that may name a record nobody checked out.
 */
export function checkReferences(writes, dropped, checkoutIds, currentById = new Map()) {
  const willBeWritten = new Set(writes.map((record) => record.id));
  const droppedIds = new Set(dropped.map((record) => record.id));
  const problems = [];

  for (const record of writes) {
    const base = currentById.get(record.id);
    const carried = new Set(base?.supersedes ?? []);
    const targets = [];
    if (record.split_from) {
      targets.push(['split_from', record.split_from, record.split_from !== base?.split_from]);
    }
    for (const target of record.supersedes ?? []) {
      targets.push(['supersedes', target, !carried.has(target)]);
    }

    for (const [field, target, isNew] of targets) {
      if (target === record.id) {
        problems.push(`${record.id}: '${field}' points at itself.`);
        continue;
      }
      if (!isNew) continue;
      if (!checkoutIds.has(target)) {
        problems.push(
          `${record.id}: '${field}' points at ${target}, which is not in the checkout. ` +
            `Check it out too (jtrek checkout --id ${target}). A reference always writes the ` +
            `target's next revision, so its current state has to be read first.`
        );
        continue;
      }
      if (droppedIds.has(target) && !willBeWritten.has(target)) {
        problems.push(
          `${record.id}: '${field}' points at ${target}, but ${target} is unchanged and would ` +
            `be dropped. A reference always appends a revision to its target. Give ${target} a ` +
            `'note' saying what happened. Without one, its timeline goes silent at exactly the ` +
            `moment it was decomposed.`
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Referential check failed:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This refuses a `related` group whose kind is not one that the vocabulary holds.
 *
 * A wrong kind is refused rather than tolerated because nothing else would ever report it. A
 * search for the records that point back at a given record filters on the kind. A row that says
 * `dependson` instead of `depends_on` is therefore stored without complaint, and then answers no
 * query that asks for `depends_on`. `R-000151` closed the vocabulary for this reason.
 *
 * Every kind in the record is checked, and not only a kind that this revision adds. That differs
 * from `split_from` and `supersedes`, where checking a carried link would have a cost. Checking a
 * carried kind costs nothing, because it brings no record into the checkout and writes no revision
 * of anything.
 */
export function checkRelationKinds(writes) {
  const problems = [];

  for (const record of writes) {
    for (const kind of Object.keys(record.related ?? {})) {
      if (RELATION_KINDS.includes(kind)) continue;
      problems.push(
        `${record.id}: 'related' groups ids under '${kind}', which is not a kind. Use one of ` +
          `${RELATION_KINDS.join(', ')}. A kind outside the list is stored without complaint, ` +
          `and then no search that asks for that kind finds it.`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Unknown relation kind:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This refuses a `detail_ref` that names no existing file, before the row is written.
 *
 * This is the one check in this file that reads the filesystem, and it does so because nothing
 * else could undo the damage afterwards. Every other check here looks only at the rows. `R-0114`
 * records the decision to make this exception. `jtrek check` already resolves `detail_ref`, in
 * its `references` group, but it runs only after the row is in `registry.ndjson`. Its
 * `inspectReferences` function also resolves every revision of a record, rather than only the
 * current one, because a prose file is shared by all of a record's revisions and is never
 * rewritten. A later revision carrying the corrected path therefore cannot clear the failure. Once
 * a bad path has been committed, the only remedies left are to create a file at the wrong path or
 * to postpone the gate.
 *
 * The mistake this catches is not unusual, and it has been made twice. `detail_ref` is resolved
 * against the store directory, so `records/R-0142.md` is correct. The path
 * `jtrek/records/R-0142.md` is wrong, because it resolves to `jtrek/jtrek/records/R-0142.md`.
 * It is nonetheless the path that works from the repository root, which is where every other tool
 * in a session resolves paths from. The code below names that case and spells out the corrected
 * value. A message that said only "does not exist" would send the reader looking for a missing
 * file, when the actual fault is a wrong prefix.
 *
 * Requiring the file to exist restates R2 rather than adding a rule. R2 says a row may not be
 * checked in until its prose is finished, and a file that has not been written is the clearest case
 * of unfinished prose.
 */
export function checkDetailRefs(writes, storeDir) {
  const problems = [];

  for (const record of writes) {
    if (!record.detail_ref) continue;
    if (fs.existsSync(path.resolve(storeDir, record.detail_ref))) continue;

    // The mistake observed in practice is a store-relative path with the store's own directory
    // name put in front of it.
    const storeName = path.basename(storeDir);
    const stripped = record.detail_ref.replace(new RegExp(`^\\.?/?${storeName}/`), '');
    const misprefixed =
      stripped !== record.detail_ref && fs.existsSync(path.resolve(storeDir, stripped));

    problems.push(
      misprefixed
        ? `${record.id}: 'detail_ref' is '${record.detail_ref}', which resolves against the store ` +
            `directory ${storeDir} and so points at a '${storeName}' inside the store. Write ` +
            `'${stripped}' instead.`
        : `${record.id}: 'detail_ref' is '${record.detail_ref}', and no file exists there ` +
            `relative to the store directory ${storeDir}. Write the prose file before checking in ` +
            `(R2). Clearing the field is not the way out: a record's first revision may not be ` +
            `checked in without one, and a later revision may not drop one the record already has.`
    );
  }

  // R-0114 holds the reasoning behind the last sentence of the message below. The id is kept in
  // this comment rather than in the message, because the store of a project that adopts jtrek does
  // not hold jtrek's own records (R-000132).
  if (problems.length > 0) {
    throw new Error(
      `detail_ref refused:\n  - ${problems.join('\n  - ')}\n` +
        `  A bad path cannot be repaired by a later revision. 'jtrek check' resolves every ` +
        `revision, so the row would fail that gate permanently.`
    );
  }
}

/**
 * This requires an `in-progress` row to say where the work stopped.
 *
 * The status does not mean that somebody is working on the record. It means that a session ended
 * with the record unfinished, and the `note` says where to resume. An `in-progress` row without a
 * note therefore records a stop that was only half made. The note is the evidence for the status,
 * rather than a comment added to it. If there is nothing to say about where the work stopped, then
 * nothing was interrupted, and the status is wrong.
 *
 * `schema.sql` enforces this rule too, so the check here exists for its error message rather than
 * for the rule. A constraint failure says `CHECK constraint failed: in_progress_needs_note`, which
 * names the rule but not the fix. Refusing here first lets the message say what to do instead.
 *
 * Adding the constraint was expensive, and the reason is worth keeping. A `CHECK` binds every row,
 * rather than every record's current row. A store can show no current `in-progress` record while
 * holding a dozen `in-progress` rows, because correcting a record appends a revision and leaves the
 * original row in place for good. The store this tool came from held five such rows without a
 * note, and the new constraint refused to load it. Those rows were edited in place, against R1, as
 * a recorded exception. Any other store in that position faces the same choice, and schema
 * versioning exists to handle it.
 */
export function checkInProgressNotes(writes) {
  const problems = writes
    .filter((record) => record.status === 'in-progress' && !record.note?.trim())
    .map(
      (record) =>
        `${record.id}: 'in-progress' needs a note saying where the work stopped and what comes ` +
        `next. The status means a session ended with this record unfinished. If nothing was ` +
        `interrupted, use 'open' instead.`
    );

  if (problems.length > 0) {
    throw new Error(`Check-in refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This keeps a parked record parked, and requires the revision that parks a record to give it a
 * prose file to write in.
 *
 * The two requirements are halves of one ruling, `R-0062`, and the second is what makes the first
 * workable.
 *
 * Once a record's `status` is `deferred`, the only revision it may take is one that changes that
 * status. Anything learned while the record is parked goes into its prose file instead. Nothing
 * versions that file, so it can be appended to freely. Moving a record out of `deferred` stays
 * possible, because the rule allows a revision that changes the status rather than forbidding all
 * revisions. A flat prohibition would freeze a parked record forever. If the condition for
 * restarting the work turns out to be wrong, the session moves the record back to `open` and then
 * parks it again with the right condition. The current row then says the right thing, rather than
 * carrying a stale condition.
 *
 * This rule replaced a safeguard by making the case it guarded against impossible. The constraint
 * `deferred_needs_note` in `schema.sql` required a reason on every deferred row, for the following
 * reason. An item parked at `rev 3` and revised at `rev 4` while still deferred left `rev 4` as the
 * current row, and the views that `build.js` and `handoff.js` produce, which are the two that
 * people read, then showed that row with the reason blank. That revision can no longer be written,
 * so while an item is parked, the revision that parked it is its current row. The constraint is
 * unchanged, and it still earns its place on the one row it now binds.
 *
 * The second half exists because `detail_ref` is a field on the row. Setting it after the record
 * was parked would itself be a forbidden revision. A record parked with no prose file could
 * therefore never gain one, and would be left parked with nowhere to write anything.
 *
 * Splitting work out of a parked record is refused with a message of its own. A partial split
 * keeps the parent's status, so it reaches this check as a deferred revision of a deferred record,
 * and the general message would be true but unhelpful. Refusing it is also the right answer on the
 * merits, and not only a mechanical one, because breaking work out of an item shows that it was not
 * really parked.
 */
export function checkDeferredRule(writes, currentById) {
  const splitTargets = new Set(writes.map((record) => record.split_from).filter(Boolean));
  const problems = [];

  for (const record of writes) {
    const wasParked = currentById.get(record.id)?.status === 'deferred';

    if (wasParked && record.status === 'deferred') {
      if (splitTargets.has(record.id)) {
        problems.push(
          `${record.id}: it is parked, and this check-in splits work out of it. Splitting a ` +
            `deferred record un-parks it first. A partial split keeps the parent's status, which ` +
            `would be a deferred revision of a deferred record. Breaking work out of an item also ` +
            `means it was not really parked. Set ${record.id} to 'open' in this same check-in.`
        );
      } else {
        problems.push(
          `${record.id}: it is parked, and a parked record takes no revision except one that ` +
            `CHANGES its status. What you learned while it was parked goes in its prose file. ` +
            `Nothing versions that file, so append to it freely. To change the row itself, move ` +
            `${record.id} to 'open' first, then park it again with a note saying why.`
        );
      }
      continue;
    }

    if (record.status === 'deferred' && !record.detail_ref) {
      problems.push(
        `${record.id}: parking a record needs a prose file, and this revision sets 'deferred' ` +
          `with no 'detail_ref'. Setting one later would itself be a forbidden revision, so a ` +
          `record parked without prose can never gain any. Write records/${record.id}.md and ` +
          `name it in 'detail_ref'. The file should name the condition that would restart the ` +
          `work, and say why it was parked rather than abandoned. A file written to satisfy a check is ` +
          `one nobody reads. The revision also needs a 'note' saying the same in one line. ` +
          `schema.sql enforces that separately, and this message names it so that a record ` +
          `missing both is told about both at once.`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Check-in refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This requires every row to name a prose file, which is meant to open with the problem the
 * record is about.
 *
 * The failure this answers is that notes carried a conclusion without the problem it answered.
 * `R-0090` had already put a requirement into `rules.md` that both parts of a record be legible to
 * a stranger, and the owner still could not follow a number of notes written after that. A
 * measurement taken on 2026-09-18 showed why the requirement alone could not fix it. 78 of the
 * store's 122 records had no prose file, and their notes were no longer than the notes of records
 * that had one. The statement of the problem was therefore not being written anywhere at all. It
 * was not a case of it being written somewhere a reader could not reach.
 *
 * The rule takes this shape because this is the first part of those requirements that a program
 * can enforce. Whether a note describes the problem cannot be checked by any program, so a rule
 * saying it must would rest on its wording alone, and wording has already been shown to fail
 * here. Whether a prose file exists can be decided, so that is what is checked. What the file says
 * is still up to the session, and `rules.md` is where it is asked for.
 *
 * Every row is bound, rather than only the first revision of each record. Revision 1 of `R-0123`
 * bound only rows at `rev: 1`, so that records written before the rule could still be revised
 * without first being given a prose file. The owner reversed that on 2026-09-18 and made the prose
 * file mandatory on every row. `jtrek query` and `registry.md` both show a record's highest
 * revision. Binding only the first revision would leave unbound every row a reader actually sees,
 * and a record whose `rev: 1` predated the rule could go on taking revisions forever with nothing
 * stating its problem.
 *
 * The cost of this falls on the records that have no prose file, and that is deliberate. Revising
 * one of them means writing its prose file first. The missing files are written one record at a
 * time, by the session that revises each one, rather than as a project of their own. A record that
 * nobody revises again never costs anything.
 *
 * Since 2026-09-20, `schema.sql` also requires every row to carry a non-empty `detail_ref`, which
 * binds rows that reach the registry by some other route than this command. The check here still
 * runs first, so that the refusal says what to write rather than naming a constraint.
 */
export function checkProseFileRequired(writes, currentById) {
  const problems = [];

  for (const record of writes) {
    if (record.detail_ref) continue;

    const had = currentById.get(record.id)?.detail_ref;

    problems.push(
      had
        ? `${record.id}: its current row names the prose file '${had}', and this revision clears ` +
            `'detail_ref'. A record's prose file is shared by all of its revisions and nothing ` +
            `versions it, so clearing the field does not unwrite the file. It only hides the file ` +
            `from every reader from here on. Carry '${had}' forward. To correct a WRONG path, ` +
            `name the right one. To retract what the file says, append a dated section saying so.`
        : `${record.id}: every row needs a prose file, and this one sets no 'detail_ref'. Write ` +
            `records/${record.id}.md, open it with what the PROBLEM is, and name ` +
            `'records/${record.id}.md' in 'detail_ref'. The note says what was concluded and is ` +
            `what a stranger reads in a list of search results. The prose file says what that ` +
            `conclusion answers, and without it a session that was not here cannot reach it. ` +
            `${currentById.has(record.id) ? `${record.id} predates this rule, so this revision is ` +
              `where its prose file gets written. One file serves every revision, so it is asked ` +
              `for once.` : ''}`.trimEnd()
    );
  }

  if (problems.length > 0) {
    throw new Error(`Check-in refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This refuses a `detail_ref` that names a prose file another record already owns.
 *
 * A prose file belongs to one record. `rules.md` states that a record has one prose file, shared
 * by all of its revisions. `R-000135` settles the converse, that a file belongs to one record
 * only, so two records naming the same file is a defect rather than an arrangement to accommodate.
 * The file opens by stating one record's problem. A second record pointing at it is therefore
 * filed under a heading that is not about it, and a reader who arrives from the second record
 * reads about the first record's subject.
 *
 * This rule cannot live in `schema.sql`. It compares a row against the rows of every other
 * record, and a `CHECK` binds one row at a time. A `UNIQUE` constraint would be wrong in the
 * opposite way, because the revisions of one record are required to name the same file.
 *
 * Ownership is read from every row, and not only from current rows. A file named by an earlier
 * revision of another record still belongs to that record, because that revision goes on pointing
 * at it.
 */
export function checkProseFileIsOwned(writes, existingRecords) {
  const owners = new Map();
  const own = (ref, id) => {
    if (!ref) return;
    if (!owners.has(ref)) owners.set(ref, new Set());
    owners.get(ref).add(id);
  };
  for (const record of existingRecords) own(record.detail_ref, record.id);
  for (const record of writes) own(record.detail_ref, record.id);

  const problems = [];
  for (const record of writes) {
    if (!record.detail_ref) continue;
    const others = [...(owners.get(record.detail_ref) ?? [])].filter((id) => id !== record.id);
    if (others.length === 0) continue;
    problems.push(
      `${record.id}: 'detail_ref' names '${record.detail_ref}', which belongs to ` +
        `${others.join(' and ')}. A prose file is one record's own, and that file opens by stating ` +
        `${others.length > 1 ? 'their' : `${others[0]}'s`} problem rather than ${record.id}'s. ` +
        `Write records/${record.id}.md and name that instead. If what ${record.id} needs is the ` +
        `prose already written there, link to it from its own file rather than naming it here. A ` +
        `pointer is not a duplicate, and it leaves each file belonging to one record.`
    );
  }

  if (problems.length > 0) {
    throw new Error(`Check-in refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This refuses a `detail_ref` inside `records/` that is not named for the record writing it.
 *
 * A reader who holds a record's id opens `records/<id>.md` directly, and that route is used far
 * more often than a query. A wrong name is refused here, rather than only reported later by
 * `jtrek check`, for the reason `checkDetailRefs` gives. `jtrek check` examines the path in every
 * revision, so once a wrong path is in the registry, no later revision can clear it (`R-000139`).
 * The check compares names only, so it adds no measurable time to a check-in.
 */
export function checkProseFileNamedForRecord(writes, storeDir) {
  const problems = writes
    .map((record) => [record, misnamedProse(record, storeDir)])
    .filter(([, expected]) => expected !== null)
    .map(
      ([record, expected]) =>
        `${record.id}: 'detail_ref' names '${record.detail_ref}', but a prose file in records/ is ` +
        `named for the record that owns it. Name the prose '${expected}' and point 'detail_ref' at it.`
    );

  if (problems.length > 0) {
    throw new Error(`Check-in refused:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * This inserts the whole store and the pending writes into a fresh database, then rolls the
 * transaction back. The constraints in the schema do the validating. Running them here proves
 * that the resulting registry would load, before a single byte is appended to it.
 */
export function dryRun(existingRecords, writes, { schemaPath } = {}) {
  const db = createDatabase({ schemaPath });
  try {
    db.exec('BEGIN');
    insertRecords(db, existingRecords);
    insertRecords(db, writes);
    db.exec('ROLLBACK');
  } catch (error) {
    logger.error('Dry run failed. Nothing was written.');
    throw error;
  } finally {
    db.close();
  }
}

/**
 * This appends the rows, and writes the store header first when the file has none yet.
 *
 * A registry that this command creates has to state its version. Otherwise the tool that just
 * wrote the store could not read it. `jtrek init` writes the header, and for a while it was the
 * only thing that did. However, `run` calls `openStore` with `allowMissing`, so a check-in into a
 * directory that holds no registry creates one. Without the header, that file states no version.
 * A registry with no version is read as coming from before versioning began, so the very next
 * command would refuse it as a store too old to load.
 *
 * The header is written only when the file is empty or absent. It is valid on line 1 and nowhere
 * else. Writing one onto a file that already holds rows would put a line into the middle of the
 * file, which is exactly the change the `history` check of `jtrek check` exists to report.
 */
export function appendToRegistry(registryPath, writes) {
  const exists = fs.existsSync(registryPath);
  const empty = !exists || fs.statSync(registryPath).size === 0;
  const needsNewline = !empty && !fs.readFileSync(registryPath, 'utf8').endsWith('\n');

  const lines = writes.map((record) => serializeRecord(record));
  if (empty) lines.unshift(serializeHeader());

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.appendFileSync(registryPath, `${needsNewline ? '\n' : ''}${lines.join('\n')}\n`);
}

/**
 * This marks the checkout as checked in, without deleting the file.
 *
 * The file has to survive, because the procedure for recovering from a git merge conflict depends
 * on it entirely. When two branches both append a revision of the same record, the session
 * resolves the conflict by taking the incoming `registry.ndjson` whole and running check-in again.
 * Check-in recomputes `rev` from the registry as it now stands, and it takes everything else from
 * `work.json`. That works only while `work.json` still holds what the session meant to write.
 * Deleting the file here would leave a conflicted merge with nothing to replay.
 *
 * The stamp is what lets `checkout` tell a finished checkout from an unfinished one. A finished
 * checkout is safe to replace, and replacing an unfinished one would lose work. Because `checkout`
 * can tell them apart, nobody has to reach for `--force` as a matter of routine.
 */
export function stampCheckedIn(workPath, workRecords) {
  const existing = JSON.parse(fs.readFileSync(workPath, 'utf8'));
  const stamped = Array.isArray(existing) ? { records: workRecords } : { ...existing };
  stamped.checked_in = localDate();
  stamped.records = workRecords;
  fs.writeFileSync(workPath, `${JSON.stringify(stamped, null, 2)}\n`);
}

export function run(argv, store) {
  const args = parseArgs(argv, store);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const workRecords = readWorkFile(args.in);
  const { db, records: existingRecords } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });

  let writes;
  let dropped;
  try {
    const currentById = new Map(currentRecords(db).map((record) => [record.id, record]));
    ({ writes, dropped } = planWrites(workRecords, currentById));
    checkReferences(writes, dropped, new Set(workRecords.map((record) => record.id)), currentById);
    checkNoteIsOwnReason(writes, currentById);
    checkRelationKinds(writes);
    checkInProgressNotes(writes);
    checkDeferredRule(writes, currentById);
    checkProseFileRequired(writes, currentById);
    checkProseFileIsOwned(writes, existingRecords);
    checkProseFileNamedForRecord(writes, store.dir);
    checkDetailRefs(writes, store.dir);
  } finally {
    db.close();
  }

  for (const record of dropped) {
    logger.info(`${record.id} is unchanged, so it was dropped.`);
  }

  // A checkout that changed nothing counts as finished, not unfinished. The stamp answers whether
  // the file is safe to replace. Every record in this file matched the store, so the file holds
  // nothing that could be lost. When such a file was left unstamped, a session that checked records
  // out and found nothing to write could not close the checkout at all. `jtrek handoff` refused to
  // proceed while the checkout was open, and the only way past was `--force`, which is exactly the
  // habit the stamp exists to prevent.
  if (writes.length === 0) {
    stampCheckedIn(args.in, workRecords);
    logger.info('Nothing changed, so the registry was not touched. The checkout is closed.');
    return 0;
  }

  // `isNew` is a flag that `planWrites` sets for its own use, and it is not a column. It is removed
  // here, before any later step sees the records.
  const rows = writes.map(({ isNew, ...record }) => record);

  // The chain value is computed last, because it covers the finished row. `planWrites` settles
  // `rev` and `ts`, and both of them feed the hash. A chain computed any earlier would therefore
  // cover a row different from the one written. The rows are chained in the order in which they
  // are about to be appended, and the first of them follows the registry's current last row.
  applyChain(rows, existingRecords);

  dryRun(existingRecords, rows, { schemaPath: store.schemaPath });
  appendToRegistry(store.registryPath, rows);

  for (const record of writes) {
    const what = record.isNew ? 'new' : `rev ${record.rev}`;
    logger.info(`${record.id} written (${what}) — ${record.title}`);
  }
  logger.info(`Appended ${rows.length} record(s) to ${store.registryPath}.`);

  stampCheckedIn(args.in, workRecords);
  logger.info(`Stamped ${args.in} as checked in. Run 'jtrek build' next.`);

  return 0;
}
