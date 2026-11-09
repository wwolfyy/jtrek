/**
 * src/store.js is the read side of the store. It was ported from the original
 * `work_tracking/scripts/lib.js`.
 *
 * This module is responsible for three things and nothing else:
 *   1. The file format. It parses and serializes `registry.ndjson`, including the header line on
 *      which a store states the format version it was written against.
 *   2. The in-memory index. It loads `schema.sql` into a SQLite database and inserts every record.
 *   3. The current state. It reduces the log to the highest revision of each record.
 *
 * Writing to the store is the job of `commands/checkin.js`, and rendering it is the job of
 * `commands/build.js`.
 *
 * The store must always be parsed and never searched with grep, because grep gives wrong answers
 * in both directions without any sign that it has done so. First, values are JSON-escaped. A title
 * displayed as "Post not found." is stored as \"Post not found.\", so a plain grep for the
 * displayed text finds nothing. Second, the file is append-only. It still holds every superseded
 * revision, so grep counts those as if they were current.
 *
 * One thing changed in the port. The original resolved the paths of `registry.ndjson` and
 * `schema.sql` when the module loaded, from its own location on disk. Nothing in this module reads
 * a path from module scope. Every function takes the paths it needs as arguments, and
 * `src/discovery.js` is the only place that decides what those paths are. That separation is what
 * lets one installed copy of the tool operate on any store.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createLogger } from './logger.js';
import { SCHEMA_PATH } from './discovery.js';
import { readText } from './text.js';

const logger = createLogger('jtrek/store');

/**
 * Every column in `schema.sql`, in its declared order. This array fixes the order in which a
 * record's fields are serialized. Because the order never varies, a record written today and the
 * same record written next year produce byte-identical lines.
 *
 * This list must be kept in step with `schema.sql`, and the two ways it can fall out of step fail
 * differently. A column listed here that the table does not have makes the first insert fail with
 * an error. A column the table has but this list omits would be dropped on write without any
 * error, and a silent loss of that kind is the failure this module exists to prevent.
 */
export const FIELDS = [
  'id',
  'rev',
  'ts',
  'type',
  'status',
  'outcome',
  'title',
  'statement',
  'feature',
  'plan',
  'detail_ref',
  'note',
  'supersedes',
  'split_from',
  'related',
  'files',
  'source_ref',
  'chain',
];

/**
 * Columns added after the store format reached version 1, which a row carries only when they hold
 * a value.
 *
 * Every other column is written into a row's line, and fed to its chain value, even when it is
 * null. These columns are left out of both whenever they are null. The reason is the chain. A row's
 * chain value is a hash of its fields, and a row written before a column existed was hashed without
 * it. If the new column were fed to the hash as an explicit null, every row already in every store
 * would hash differently and report as altered, although none of them changed. Leaving a null new
 * column out of the hash reproduces exactly what those rows were hashed from. A column added this
 * way therefore needs no migration and no new format version, which is what the `schema.sql` header
 * promises for a nullable column. The owner chose this on 2026-09-26, under `R-000182`.
 *
 * Nothing about a row's protection is lost. A value written into one of these columns later, or
 * removed from a row that had one, still changes that row's hash.
 *
 * A column added in future joins this set. The set must never lose a member. Removing one would
 * put an explicit null back into the hash of every row that lacks the column.
 */
export const SPARSE_FIELDS = new Set(['statement', 'feature']);

/**
 * The fields of `record` that its line and its chain value hold, as an object in declared order.
 *
 * Every column appears, with null for a missing value, except a column in `SPARSE_FIELDS` whose
 * value is null, which does not appear at all.
 */
function canonicalFields(record, fields) {
  const canonical = {};
  for (const key of fields) {
    const value = record[key] ?? null;
    if (value === null && SPARSE_FIELDS.has(key)) continue;
    canonical[key] = value;
  }
  return canonical;
}

/**
 * The field that links each row to the row before it. It is the one field that no session writes,
 * because jtrek computes it at check-in.
 *
 * It comes last in the list above because its value is computed from every field that precedes
 * it. A reader who follows the list in order therefore reaches it after seeing everything it
 * covers.
 */
export const CHAIN_FIELD = 'chain';

/**
 * The fields that feed the hash, which are every field except the chain itself.
 *
 * A hash cannot cover the field it is stored in, because the value would have to exist before it
 * was computed. Leaving the chain field out is therefore what makes the computation possible.
 * Leaving it out also loses no protection. Each row's hash takes in the chain value of the row
 * before it. If someone alters the chain value stored on one row, the hash computed for the next
 * row no longer matches, so the alteration is detected either way.
 */
export const CHAINED_FIELDS = FIELDS.filter((field) => field !== CHAIN_FIELD);

/**
 * The value that the first row in a store is chained to.
 *
 * A chain needs a starting value, and that value must not be the empty string. With an empty
 * starting value, the first row's hash would be a hash of that row alone, which is exactly what
 * someone fabricating a first row would compute. A fixed, named starting value makes the first
 * row's hash depend on something that belongs to the format rather than to the row.
 *
 * The value is not a secret, and it is not meant to provide secrecy. `R-0036` considered a secret
 * constant and concluded that it would be worth nothing at all, not merely a little. Anything that
 * can run `jtrek checkin` can read whatever `jtrek checkin` reads. A constant shipped in the
 * package is therefore known to every actor the chain is meant to catch. What the chain detects is
 * a row appended by something that computed no hash, and that detection works whether or not the
 * starting value can be guessed.
 *
 * Changing this value would invalidate every chained row in every store at once. The value
 * therefore names, in its own text, the format version it belongs to.
 *
 * It was `jtrack/chain/v1` while the tool was called jtrack. `R-000600` changed it with the name,
 * and `jtrek migrate --from-jtrack` recomputes a jtrack store's chain from this value.
 */
export const CHAIN_SEED = 'jtrek/chain/v1';

/**
 * A record's canonical form for hashing. It holds every field except the chain, in the declared
 * order, and it leaves out a column from `SPARSE_FIELDS` when that column is null.
 */
export function chainInput(record) {
  return JSON.stringify(canonicalFields(record, CHAINED_FIELDS));
}

/**
 * The chain value for a row that follows a row whose chain value is `previous`.
 *
 * In any hashing scheme like this one, the fragile part is producing the same bytes for the same
 * record every time. Key order, whitespace, absent values and number formatting must all come out
 * identically, or a recomputed hash will not match the stored one. `serializeRecord` already had
 * to solve that problem to keep the registry's lines stable. `chainInput` above reuses its
 * solution, which is to write the fields in the declared order and to write every absent value as
 * an explicit null.
 */
export function chainValue(previous, record) {
  return createHash('sha256').update(`${previous}${chainInput(record)}`).digest('hex');
}

/**
 * Sets the chain value on each of `rows`, as those rows will sit after `preceding` in the file.
 *
 * The rows are chained in the order in which they will be written. The first of them is chained to
 * the last row already in the registry, or to the starting value when the registry holds no rows.
 */
export function applyChain(rows, preceding = []) {
  let previous = preceding.length > 0 ? preceding[preceding.length - 1].chain : CHAIN_SEED;
  for (const row of rows) {
    row.chain = chainValue(previous, row);
    previous = row.chain;
  }
  return rows;
}

/**
 * Returns every row whose stored chain value differs from the value its contents and position
 * produce.
 *
 * After a mismatch, verification continues from the stored value of the mismatched row. It does not
 * stop, and it does not carry the computed value forward. If it carried the computed value forward,
 * a single altered row would make every row after it report as broken, and a report naming three
 * hundred rows would not say which one was touched. Continuing from the stored value limits the
 * report to the rows that are actually wrong. It still catches every alteration: a row whose
 * predecessor was altered still fails, because its own hash covers the predecessor's value.
 *
 * `seed` is the starting value the first row is checked against. Only `jtrek migrate
 * --from-jtrack` passes another value, because it verifies a jtrack store's chain against the seed
 * jtrack used before it recomputes that chain.
 */
export function chainBreaks(records, seed = CHAIN_SEED) {
  const breaks = [];
  let previous = seed;
  records.forEach((record, index) => {
    const expected = chainValue(previous, record);
    if (record.chain !== expected) {
      // The position is the row's place among the store's rows, not its line number in the file.
      // A version-1 store always opens with a header line, so the two numbers differ by one.
      // Reporting the position avoids printing a line number that is off by exactly one.
      breaks.push({
        position: index + 1,
        id: record.id,
        rev: record.rev,
        stored: record.chain,
        expected,
      });
    }
    previous = record.chain;
  });
  return breaks;
}

/**
 * Fields that `jtrek checkout` writes into `work.json` to give the session context, and that
 * `jtrek checkin` removes again.
 *
 * These fields are not columns. They must therefore be removed before a record reaches
 * `assertRecordShape`, which refuses any key it does not recognise so that a misspelt field is
 * never written. The leading underscore tells a reader that editing one of these fields has no
 * effect.
 */
export const TRANSIENT_FIELDS = new Set(['_note_history']);

/** A copy of `record` with the transient fields removed. */
export function stripTransient(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return record;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TRANSIENT_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Returns the note of every earlier revision, one entry per revision, with any repeated earlier
 * text removed.
 *
 * A note is meant to say why its own revision exists. For two days in August 2026, however, notes
 * were written by appending to the previous revision's note, so 36 rows begin with the full text
 * of every earlier note. Joining those notes as they stand would repeat the whole history once per
 * revision. Removing the earlier note from the start of each one recovers what that revision
 * actually added. When a note does not begin with the previous note, it is shown whole. That
 * output is less tidy, but it does not hide anything. `R-0064` holds the reasoning.
 *
 * The current revision is left out, because its note is already on the record being worked on.
 */
export function noteHistory(db, id, currentRev) {
  const rows = db
    .prepare('SELECT rev, ts, note FROM records WHERE id = ? AND rev < ? ORDER BY rev')
    .all(id, currentRev);

  const entries = [];
  let previous = '';
  for (const row of rows) {
    const note = row.note ?? '';
    const own = previous && note.startsWith(previous) ? note.slice(previous.length).trim() : note;
    if (own) entries.push(`rev ${row.rev} (${row.ts}): ${own}`);
    previous = note;
  }
  return entries;
}

/** Columns that hold JSON as text. They are parsed on read and stringified on write. */
export const JSON_FIELDS = new Set(['supersedes', 'files', 'related']);

/**
 * Of the JSON columns, the ones that hold an object rather than an array.
 *
 * `related` groups its ids by the kind of relation, as in `{"depends_on": ["R-0039"]}`. It does so
 * because a session searches by the kind, as `R-000151` decided. Every other JSON column is a flat
 * list.
 */
export const JSON_OBJECT_FIELDS = new Set(['related']);

/**
 * The kinds of relation under which `related` may group its ids.
 *
 * There are three, and the list is deliberately closed. A search for the records that point at a
 * given record filters on the kind. A misspelt kind would therefore not cause a visible error.
 * The row would be stored, the query for `depends_on` would skip it, and nothing would show that the
 * link had ever been written. `R-000151` chose the first two kinds.
 *
 * The rule cannot be a `CHECK` constraint in `schema.sql`, because a constraint there applies to
 * one row and cannot loop over the keys of an object. Instead, `jtrek checkin` enforces it when a
 * row is written, and the `references` group of `jtrek check` catches any row that reached the
 * registry some other way. `detail_ref` is enforced with the same division of work.
 *
 * `depends_on` states where a record came from, and that statement stays true permanently. That
 * permanence is what separates it from the `blocked_by` field that `R-0031` rejected. A
 * `blocked_by` field would assert a current condition, and it would become false without any sign
 * of it as soon as the blocking record closed.
 *
 * `implements` was added on 2026-09-26 by `R-000182`. A task lists under it each `requirement`
 * record that the task meets or changes. With only `related_to`, a search for the work that
 * implements a requirement would also return every bug and decision that merely mentions it.
 */
export const RELATION_KINDS = ['depends_on', 'related_to', 'implements'];

/** Columns declared as INTEGER. */
export const INTEGER_FIELDS = new Set(['rev']);

/**
 * The file and line each record was read from, such as `registry.ndjson:42`, for use in error
 * messages. The locations are kept beside the records rather than inside them, so that a record
 * serializes back out exactly as it came in.
 */
const ORIGINS = new WeakMap();

/** Returns where a record was parsed from, or null if it was built in memory. */
export function originOf(record) {
  return ORIGINS.get(record) ?? null;
}

/**
 * Checks the structure of a record. It checks the shape of each field and not its value.
 *
 * The rules about values, such as the allowed statuses, the date format, the id pattern and a
 * non-empty title, belong to `schema.sql` and are enforced there, so that each rule exists in one
 * place only. SQLite cannot catch a key that the table does not have. The insert statement names
 * its columns, so a misspelt field would simply be left out, with no error. The original design
 * was tested for exactly this failure, in which a write reports success and stores nothing of the
 * misspelt field. This function catches it instead.
 */
export function assertRecordShape(record, origin) {
  const where = origin ? ` (${origin})` : '';

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Record must be a JSON object${where}, got ${JSON.stringify(record)}`);
  }

  for (const key of Object.keys(record)) {
    if (!FIELDS.includes(key)) {
      throw new Error(
        `Unknown field '${key}'${where}. Known fields: ${FIELDS.join(', ')}. ` +
          `If this field is genuinely new, add it to schema.sql and to FIELDS in src/store.js.`
      );
    }
  }

  for (const key of FIELDS) {
    const value = record[key];
    if (value === undefined || value === null) continue;

    if (JSON_OBJECT_FIELDS.has(key)) {
      if (typeof value !== 'object' || Array.isArray(value)) {
        // `typeof []` is 'object'. Reporting the raw typeof would therefore print "must be an
        // object, got object", which is correct but reads as a contradiction.
        const got = Array.isArray(value) ? 'an array' : `a ${typeof value}`;
        throw new Error(`Field '${key}'${where} must be an object or null, got ${got}`);
      }
      for (const [kind, ids] of Object.entries(value)) {
        if (!Array.isArray(ids)) {
          throw new Error(
            `Field '${key}'${where} groups ids by kind, so '${kind}' must hold an array, ` +
              `got ${typeof ids}`
          );
        }
      }
      continue;
    }
    if (JSON_FIELDS.has(key)) {
      if (!Array.isArray(value)) {
        throw new Error(`Field '${key}'${where} must be an array or null, got ${typeof value}`);
      }
      continue;
    }
    if (INTEGER_FIELDS.has(key)) {
      if (!Number.isInteger(value)) {
        throw new Error(`Field '${key}'${where} must be an integer, got ${JSON.stringify(value)}`);
      }
      continue;
    }
    if (typeof value !== 'string') {
      throw new Error(`Field '${key}'${where} must be a string or null, got ${typeof value}`);
    }
  }
}

/**
 * The store format version that this copy of jtrek reads and writes.
 *
 * A store with no header line is at version 0 by definition. Versioning was added after the
 * format already existed, so stores written before then could not announce a version, and the
 * absence of a header is the only thing they can say. Reading that absence as version 0 lets
 * versioning start without a migration of its own. One might object that adding a version marker
 * is itself a change of format, and so would need the very mechanism it introduces. Treating the
 * absence as 0 answers that objection.
 *
 * The version became 1 on 2026-09-24, which is the first time it has changed. It stayed at 0 for
 * as long as the schema did not change, so every existing store could be read exactly as it stood.
 * The `chain` column added under `R-0036` ended that. The column is `NOT NULL`, and its value is
 * derived from the row before it, so it cannot be given a default. A store written before the
 * column existed therefore does not satisfy the schema. The version number rises for exactly that
 * kind of change, and `jtrek migrate` writes the new number when it rebuilds a store.
 *
 * Both of `assertVersion`'s refusals can now occur, which was not true at version 0. A store with
 * no header states version 0, so it is older than this tool. A store stating version 2 or higher
 * was written by a newer jtrek than this one. `assertVersion` still takes the tool's version as an
 * argument, so that a test can exercise either direction without needing a store at a version that
 * no release uses.
 */
export const SCHEMA_VERSION = 1;

/**
 * The key that marks the registry's first line as a header rather than a record.
 *
 * This key can never be confused with a record. `assertRecordShape` refuses any key that is not a
 * column, so no row has ever carried this key and none can be written with it.
 *
 * It was `jtrack_schema` while the tool was called jtrack. `R-000600` changed it with the name, and
 * `jtrek migrate --from-jtrack` rewrites a jtrack store's header to this key.
 */
export const VERSION_KEY = 'jtrek_schema';

/** Returns the header line for a store at `version`, with no trailing newline. */
export function serializeHeader(version = SCHEMA_VERSION) {
  return JSON.stringify({ [VERSION_KEY]: version });
}

/** Returns true when a parsed line is the header rather than a record. */
function isHeader(parsed) {
  return (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.hasOwn(parsed, VERSION_KEY)
  );
}

/**
 * Returns the version that a registry's text states. It reads line 1 and nothing else.
 *
 * This function exists so that a store written by a newer jtrek can be refused before it is
 * parsed. `parseRegistry` validates the shape of every row, and `assertRecordShape` refuses any
 * field that the current `FIELDS` does not name. A store with a column added after this copy of the
 * tool was released would therefore fail with a message about an unknown field. That message
 * blames the row, when the real cause is that the tool is out of date. `jtrek migrate` calls this
 * function first and reports the version instead.
 *
 * When the first line is not a header, the function returns null. That absence of a header means
 * version 0.
 */
export function readVersion(text) {
  const [first] = text.split('\n', 1);
  if (!first || first.trim() === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(first);
  } catch {
    // A malformed first line is a real fault, but diagnosing it is not this function's job.
    // `parseRegistry` reports it with the line number and the parse error, which is a better
    // message than this function could give.
    return null;
  }
  return isHeader(parsed) && Number.isInteger(parsed[VERSION_KEY]) ? parsed[VERSION_KEY] : null;
}

/**
 * Parses NDJSON text into a version and its records.
 *
 * Blank lines are skipped. Any other line that is neither the header nor a valid record causes an
 * error that names the line.
 *
 * A header is accepted only on line 1. Allowing it anywhere else would cause two problems. First, a
 * store could state two different versions, and the reader would have to pick one. Second, it
 * would break the append-only rule that the `history` check enforces. Every write after the first
 * appends to the end of the file, so a header on a later line could only have got there by being
 * inserted. Refusing a header below line 1 avoids both problems, and the error names the line so
 * that the fault can be found.
 */
export function parseRegistry(text, source = 'registry.ndjson') {
  const records = [];
  const lines = text.split('\n');
  let version = null;

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const origin = `${source}:${index + 1}`;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      logger.error(`Malformed JSON at ${origin}`);
      throw new Error(`Malformed JSON at ${origin}: ${error.message}`, { cause: error });
    }

    if (isHeader(parsed)) {
      // Only line 1 may hold the header. Blank lines are skipped above, so asking whether a row or
      // a header came first would accept a header after a blank line 1, which `readVersion` does
      // not read as a header (`R-000623`).
      if (index > 0) {
        logger.error(`Misplaced store header at ${origin}`);
        throw new Error(
          `The store header at ${origin} is not the first line of the file. A store states its ` +
            `format version once, on line 1, because every write after that one appends to the end.`
        );
      }
      const stated = parsed[VERSION_KEY];
      if (!Number.isInteger(stated) || stated < 0) {
        logger.error(`Invalid store version at ${origin}`);
        throw new Error(
          `The store header at ${origin} states a version of ${JSON.stringify(stated)}. ` +
            `A version is a whole number of 0 or more.`
        );
      }
      version = stated;
      return;
    }

    try {
      assertRecordShape(parsed, origin);
    } catch (error) {
      logger.error(`Invalid record at ${origin}`);
      throw error;
    }

    ORIGINS.set(parsed, origin);
    records.push(parsed);
  });

  return { version, records };
}

/**
 * The error that `assertVersion` throws. It has its own type so that a caller can tell a version
 * mismatch apart from a row that failed validation.
 *
 * The message carries the whole explanation, and every command prints it unchanged. The separate
 * type exists for callers that add advice of their own. `jtrek init` prints a remedy before the
 * error reaches the reader, and a remedy written for a bad row is the wrong advice for a store at
 * another version, as `R-000158` found. `direction` is `'older'` when the store predates this
 * jtrek and `'newer'` when a later jtrek wrote it.
 */
export class StoreVersionError extends Error {
  constructor(message, { stated, toolVersion }) {
    super(message);
    this.name = 'StoreVersionError';
    this.stated = stated;
    this.toolVersion = toolVersion;
    this.direction = stated < toolVersion ? 'older' : 'newer';
  }
}

/**
 * Refuses a store that this jtrek cannot read, and says which way the mismatch runs.
 *
 * The two directions are different problems, so they must not share a message. A store older than
 * the tool has rows that predate a schema change, and the fix is to rebuild the store. A store newer
 * than the tool has rows written against a schema this tool has never seen, and the fix is to
 * update the tool. Rebuilding would be entirely wrong in that case, because it is this copy of
 * jtrek that is behind. A single message saying only "version mismatch" would leave the reader to
 * guess which case applies, and a wrong guess could cost them their store.
 *
 * An empty store with no header is treated as current. A store with no rows gives a migration
 * nothing to act on, so refusing it would send its owner to rebuild an empty file. An explicit
 * header always takes precedence over this rule, in both directions. A store that states its
 * version is taken at its word, however few rows it holds.
 */
export function assertVersion(
  version,
  { records = [], toolVersion = SCHEMA_VERSION, registryPath = 'the store' } = {}
) {
  const stated = version === null && records.length === 0 ? toolVersion : (version ?? 0);
  if (stated === toolVersion) return stated;

  if (stated < toolVersion) {
    logger.error(`${registryPath} is at store format version ${stated}; this jtrek reads ${toolVersion}.`);
    throw new StoreVersionError(
      `${registryPath} is at store format version ${stated}, and this jtrek reads version ` +
        `${toolVersion}. Its rows were written against an earlier schema and will not load as ` +
        `they stand. Run 'jtrek migrate' to rebuild the store against the current schema. It ` +
        `reads what is there, builds a new store, validates that before writing anything, and ` +
        `refuses while the registry has uncommitted changes.`,
      { stated, toolVersion }
    );
  }

  logger.error(`${registryPath} is at store format version ${stated}; this jtrek reads ${toolVersion}.`);
  throw new StoreVersionError(
    `${registryPath} is at store format version ${stated}, and this jtrek reads version ` +
      `${toolVersion}. The store was written by a newer jtrek than this one, so it is this copy ` +
      `of the tool that is behind. Update jtrek rather than changing the store.`,
    { stated, toolVersion }
  );
}

/**
 * Reads the store from disk.
 *
 * `allowMissing` is for callers that legitimately run against an empty store, such as a build
 * before the first record exists or a checkout on a fresh clone. For every other caller, a missing
 * registry is a real error and is reported as one.
 */
export function loadRegistry({ registryPath, allowMissing = false }) {
  let text;
  try {
    text = readText(registryPath);
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) {
      logger.info(`No registry at ${registryPath} — treating the store as empty.`);
      // A registry that does not exist states no version and holds nothing to migrate. It is
      // therefore treated as the current format rather than an old one.
      return { version: SCHEMA_VERSION, records: [] };
    }
    logger.error(`Cannot read the registry at ${registryPath}`);
    throw error;
  }
  return parseRegistry(text, path.basename(registryPath));
}

/**
 * Converts a record to a database row. JSON values are serialized to text, and absent fields are
 * set explicitly to null.
 */
export function toRow(record) {
  const row = {};
  for (const key of FIELDS) {
    const value = record[key];
    if (value === undefined || value === null) {
      row[key] = null;
    } else if (JSON_FIELDS.has(key)) {
      row[key] = JSON.stringify(value);
    } else {
      row[key] = value;
    }
  }
  return row;
}

/** Converts a database row back to a record, with its fields in the declared order. */
export function fromRow(row) {
  const record = {};
  for (const key of FIELDS) {
    const value = row[key] ?? null;
    record[key] = value !== null && JSON_FIELDS.has(key) ? JSON.parse(value) : value;
  }
  return record;
}

/**
 * Serializes one record as one NDJSON line, with its fields in the declared order and no trailing
 * newline.
 */
export function serializeRecord(record) {
  assertRecordShape(record, originOf(record));
  return JSON.stringify(canonicalFields(record, FIELDS));
}

/**
 * Creates an empty in-memory database with `schema.sql` applied. Nothing is written to disk.
 */
export function createDatabase({ schemaPath = SCHEMA_PATH } = {}) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    logger.error(`Cannot apply the schema from ${schemaPath}`);
    db.close();
    throw error;
  }
  return db;
}

/**
 * Inserts records into an open database. This is where the schema validates records. A value
 * outside an allowed set, a malformed id or a duplicate `(id, rev)` pair is reported here, together
 * with the line the record came from.
 */
export function insertRecords(db, records) {
  const columns = FIELDS.join(', ');
  const placeholders = FIELDS.map((field) => `$${field}`).join(', ');
  const insert = db.prepare(`INSERT INTO records (${columns}) VALUES (${placeholders})`);

  for (const record of records) {
    try {
      insert.run(toRow(record));
    } catch (error) {
      const where = originOf(record) ?? `${record.id ?? '?'} rev ${record.rev ?? '?'}`;
      logger.error(`Record rejected by the schema (${where}): ${error.message}`);
      throw new Error(`Record rejected by the schema (${where}): ${error.message}`, {
        cause: error,
      });
    }
  }
}

/**
 * Opens the whole store, indexed and ready to query.
 *
 * The index is rebuilt from `registry.ndjson` on every run. At the size of the mohocat project's
 * store, that took about 11 milliseconds. Rebuilding every time means that no index is saved to
 * disk, so there is no saved index that could fall out of step with the log. Every record is also
 * validated again on every run, so a bad row anywhere in the store causes an immediate error.
 *
 * The caller owns the returned database and must call `close()` on it.
 */
export function openStore({ registryPath, schemaPath = SCHEMA_PATH, allowMissing = false }) {
  const { version, records } = loadRegistry({ registryPath, allowMissing });

  // The version is checked before the rows reach the schema. Otherwise a store written against a
  // different schema would fail at its first offending row. That failure would report a
  // constraint the reader never chose to break, rather than the version mismatch that actually
  // caused it. Every command reads the store through this function, so this one check covers all
  // of them.
  assertVersion(version, { records, registryPath });

  const db = createDatabase({ schemaPath });
  try {
    insertRecords(db, records);
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, records, version: version ?? SCHEMA_VERSION };
}

/**
 * How record ids are ordered, both in SQL and in JavaScript.
 *
 * Ids do not all have the same width, so comparing them as text gives the wrong order. jtrek pads
 * a new id to six digits, and `schema.sql` accepts four digits or more, so one store holds ids of
 * both widths. Compared as text, `R-000124` sorts before `R-0123`. In a store that has grown past
 * six digits, `R-1000000` would sort before `R-999999`. Both the SQL expression and the JavaScript
 * function below therefore compare the number after `R-`, which gives the right order at every
 * width. `R-000124` is the decision that made ids variable in width.
 *
 * The two orderings must agree. `registry.md` is rendered from rows that this SQL expression
 * ordered, while the lists of child records inside it are sorted in JavaScript. If the two
 * disagreed, a fresh render could differ from the committed file, and `jtrek build --check` would
 * fail.
 */
export const ID_ORDER = 'CAST(substr(id, 3) AS INTEGER)';

/** Compares two record ids by their number, for use with `Array.prototype.sort`. */
export function compareIds(a, b) {
  return Number(a.slice(2)) - Number(b.slice(2));
}

/**
 * Returns the current revision of every record. The whole design rests on this reduction of the
 * log. It returns one row per `id`, the row with the highest `rev`, ordered by id so that the
 * output is the same on every run.
 */
export function currentRecords(db) {
  return db.prepare(`SELECT * FROM current_records ORDER BY ${ID_ORDER}`).all().map(fromRow);
}

/** Returns every revision of one record, oldest first. */
export function revisionsOf(db, id) {
  return db.prepare('SELECT * FROM records WHERE id = ? ORDER BY rev').all(id).map(fromRow);
}

/**
 * Returns every revision of each requested id, oldest first, grouped by id in the order the ids
 * were given. As with `selectByIds`, a missing id is an error rather than an empty result.
 *
 * This is the only read that looks beyond `current_records`. `selectByQuery` runs every predicate
 * against the current rows, and every query a session writes is meant to be about current rows.
 * Earlier revisions are therefore read by id, through this function and the separate
 * `jtrek history` command. A flag on `jtrek query` was not used, because it would change what an
 * existing predicate means. `R-000149` made that decision.
 */
export function selectHistory(db, ids) {
  const found = [];
  const missing = [];

  for (const id of ids) {
    const revisions = revisionsOf(db, id);
    if (revisions.length > 0) found.push(...revisions);
    else missing.push(id);
  }

  if (missing.length > 0) {
    throw new Error(`No such record(s) in the store: ${missing.join(', ')}`);
  }
  return found;
}

/**
 * Returns the current revision of each requested id. A missing id is an error rather than an empty
 * result.
 *
 * This function and `selectByQuery` live in this module rather than in a command, because two
 * commands select records in the same way. They differ only in what they do afterwards: `checkout`
 * takes the records, and `query` only reads them.
 */
export function selectByIds(db, ids) {
  const found = [];
  const missing = [];

  for (const id of ids) {
    const row = db.prepare('SELECT * FROM current_records WHERE id = ?').get(id);
    if (row) found.push(fromRow(row));
    else missing.push(id);
  }

  if (missing.length > 0) {
    throw new Error(`No such record(s) in the store: ${missing.join(', ')}`);
  }
  return found;
}

/**
 * Returns the current rows that name `id` in their `supersedes` list, which are the records that
 * replaced it.
 *
 * Only the successor stores the link, so this is the only direction from which it can be read. A
 * superseded row carries `outcome: 'superseded'` and nothing else. The id of the record that
 * replaced it is written into that successor's `supersedes` list, and never back into the row it
 * replaced. For the same reason, `rules.md` tells a session to find a successor with a query over
 * `supersedes`.
 *
 * A `LIKE` match on the JSON text would find `R-0012` inside `R-00123`. The array is therefore
 * expanded with `json_each`, and the ids are compared whole. The ordering names `r.id` rather than
 * reusing `ID_ORDER`, because `json_each` has an `id` column of its own, and the bare name would be
 * ambiguous between the two.
 */
export function supersededBy(db, id) {
  return db
    .prepare(
      `SELECT r.id FROM current_records r, json_each(r.supersedes)
       WHERE r.supersedes IS NOT NULL AND json_each.value = ?
       ORDER BY CAST(substr(r.id, 3) AS INTEGER)`
    )
    .all(id)
    .map((row) => row.id);
}

/**
 * Returns the current revision of every record that matches a SQL predicate.
 *
 * The predicate is inserted directly into the query text. That is safe here, and would not be safe
 * elsewhere, for four reasons. The database is in memory. It is built fresh from a file the caller
 * already has on disk. It is discarded when the command exits. The predicate is typed by the same
 * person who runs the command. No input reaches this function from a network.
 */
export function selectByQuery(db, predicate) {
  try {
    return db
      .prepare(`SELECT * FROM current_records WHERE ${predicate} ORDER BY ${ID_ORDER}`)
      .all()
      .map(fromRow);
  } catch (error) {
    logger.error(`The query is not valid SQL: ${predicate}`);
    throw new Error(`The query is not valid SQL: ${predicate} — ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Writes an open in-memory store to a SQLite file, so that it can be opened in a database browser.
 *
 * The file is derived from the store and is gitignored. It is a view of the store and never an
 * input to anything. `registry.ndjson` remains the only source of truth, and nothing in the tool may
 * read the `.db` file back. If anything did, the store would have two sources of truth, and the
 * append-only design would no longer guarantee anything.
 *
 * `VACUUM INTO` copies the database the caller already loaded, including its views. The views are
 * the reason for writing the file, because the `current_records` view is what makes it worth
 * opening. `VACUUM INTO` refuses to write over an existing file, so the old file is removed first.
 * A useful consequence is that a failed run leaves no file at all, rather than an old file that
 * looks current.
 */
export function writeDatabase(db, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.rmSync(outPath, { force: true });
  db.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
  return outPath;
}
