/**
 * src/commands/build.js implements `jtrek build`, which is step 4 of the loop.
 *
 * The command regenerates `registry.md`, which shows the current revision of every record for the
 * people who read pull requests. Nobody reads `registry.ndjson` by choice.
 *
 * The output must depend on the store and on nothing else. It may carry no timestamp, and it may
 * not read the clock or the environment. `--check` compares a fresh render against the committed
 * file. Anything that varied between runs would therefore make that gate fail on every run,
 * whether or not a record had changed.
 *
 * Both outputs are always written into the store. `registry.md` and `registry.db` belong to the
 * store, rather than to the run that produced them, so there is no flag to write them elsewhere. A
 * rendered copy that lives apart from the log it was rendered from is a second copy waiting to be
 * mistaken for the real one. Inspecting without writing is what `--check` is for.
 *
 * The command also rewrites the rendered part of the spec document, `jtrek_spec.md`, when the
 * project has one. That part lists the statements of the requirements in force under each feature's
 * heading, and `src/spec.js` explains where it begins and ends. It is rendered here rather than by a
 * planning command because requirements change during development as well as during planning, and a
 * spec rendered only in planning would be stale after every such change (`R-000201`). The spec is
 * never created here. `jtrek agent install` creates it once, because the rest of the document is a
 * person's writing.
 *
 * Usage:
 *   jtrek build            regenerate registry.md AND registry.db (gitignored, for browsing), and
 *                           the requirements in the spec document when there is one
 *   jtrek build --check    verify the committed registry.md and spec document match the store (a gate)
 */

import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { compareIds, currentRecords, openStore, writeDatabase } from '../store.js';
import { SPEC_FILENAME, renderSpec } from '../spec.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/build');

export const USAGE = 'Usage: jtrek build [--check]';

/**
 * These lists set the order of the rows and columns in the summary. They duplicate the allowed
 * values in `schema.sql`, so the two can drift apart. `assertKnownValues` below turns that drift
 * into a loud failure rather than a silent one. When `deferred` was added, the list of statuses
 * here still held four values. The summary then quietly dropped seven records, while its totals for
 * each type stayed right, so its columns simply stopped adding up.
 */
export const TYPES = ['task', 'bug', 'change', 'decision', 'question', 'requirement'];
// The statuses are ordered with active work first, then work that is wanted but not being worked
// on, then closed work. A reader scanning the table therefore meets first the columns that ask
// something of them. 'planned' sits beside 'deferred' because neither can be started. They differ
// in why, and saying why is the job of the status name.
export const STATUSES = ['open', 'in-progress', 'planned', 'deferred', 'done', 'abandoned'];

export function parseArgs(argv) {
  const args = { check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--check') {
      args.check = true;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
      return args;
    } else {
      throw new UsageError(`Unknown argument '${flag}'. ${USAGE}`);
    }
  }
  return args;
}

/** This makes a table cell one line long, and escapes any character that would break the column. */
function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');
}

/**
 * This builds the link to a record's prose file. Most records point at their prose in `records/`.
 * Companion documents point out of the store, at the file where they already live, and adding a
 * `./` prefix to such a path would produce `./../docs/…`. Both forms are relative to `registry.md`.
 */
function detailCell(record) {
  if (!record.detail_ref) return '—';
  const href = record.detail_ref.startsWith('.') ? record.detail_ref : `./${record.detail_ref}`;
  return `[detail](${href})`;
}

function table(header, rows) {
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

/** This refuses to render a store holding a `type` or `status` that this file does not list. */
export function assertKnownValues(records) {
  const unknown = [];
  for (const record of records) {
    if (!TYPES.includes(record.type)) unknown.push(`${record.id}: type '${record.type}'`);
    if (!STATUSES.includes(record.status)) unknown.push(`${record.id}: status '${record.status}'`);
  }
  if (unknown.length > 0) {
    throw new Error(
      `The store holds values the renderer does not know about, and rendering would silently ` +
        `drop them from the summary:\n  - ${unknown.slice(0, 10).join('\n  - ')}\n` +
        `Add them to TYPES / STATUSES in src/commands/build.js — they are already legal in ` +
        `schema.sql.`
    );
  }
}

function summarySection(records) {
  const rows = TYPES.map((type) => {
    const ofType = records.filter((record) => record.type === type);
    return [
      type,
      ...STATUSES.map((status) => String(ofType.filter((r) => r.status === status).length)),
      `**${ofType.length}**`,
    ];
  });
  rows.push([
    '**total**',
    ...STATUSES.map((status) => `**${records.filter((r) => r.status === status).length}**`),
    `**${records.length}**`,
  ]);
  return table(['type', ...STATUSES, 'total'], rows);
}

function recordRows(records) {
  return records.map((record) => [
    record.id,
    cell(record.type),
    cell(record.status),
    cell(record.outcome),
    cell(record.plan),
    cell(record.title),
    detailCell(record),
  ]);
}

const RECORD_HEADER = ['id', 'type', 'status', 'outcome', 'plan', 'title', 'detail'];

/**
 * This lists each parent and the records broken out of it, with how many of them are done. Only
 * parents that actually have children appear, because a tree of records with no children would
 * help nobody.
 */
function hierarchySection(db, records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  // Parents are ordered by the number in their id rather than by its text, because ids are not
  // all the same width. ID_ORDER in store.js explains this.
  const rollups = db
    .prepare('SELECT * FROM children_progress ORDER BY CAST(substr(parent_id, 3) AS INTEGER)')
    .all();

  if (rollups.length === 0) return '_No records have been broken out into children._';

  const lines = [];
  for (const rollup of rollups) {
    const parent = byId.get(rollup.parent_id);
    lines.push(
      `- **${parent.id}** [${parent.status}] ${cell(parent.title)} ` +
        `— _(${rollup.children_done}/${rollup.children} children done)_`
    );
    const children = records
      .filter((record) => record.split_from === parent.id)
      .sort((a, b) => compareIds(a.id, b.id));
    for (const child of children) {
      lines.push(`  - ${child.id} [${child.status}] ${cell(child.title)}`);
    }
  }
  return lines.join('\n');
}

/**
 * This lists the requirements in force, grouped by feature, each with its exact statement.
 *
 * The list comes from the `requirements_in_force` view, which holds every `requirement` record that
 * is `done` and not superseded. Read feature by feature, it is what a spec document would say about
 * the product, computed from the records rather than written by hand (`R-000181`). A statement is
 * the requirement itself, so it is shown whole rather than cut to fit a table cell.
 */
function requirementsSection(db) {
  const rows = db
    .prepare('SELECT * FROM requirements_in_force ORDER BY feature, CAST(substr(id, 3) AS INTEGER)')
    .all();
  if (rows.length === 0) return '_No requirement is in force._';

  const lines = [];
  let feature = null;
  for (const row of rows) {
    if (row.feature !== feature) {
      feature = row.feature;
      lines.push(`- **${cell(feature)}**`);
    }
    lines.push(`  - **${row.id}** ${cell(row.title)} — ${cell(row.statement)}`);
  }
  return lines.join('\n');
}

/**
 * This lists parked work, with the reason each item is parked. The reason is the whole point of
 * `deferred`, because a parked item whose condition cannot be seen looks the same as a forgotten
 * one. It therefore gets its own section, rather than a cell in a table too wide to carry it.
 */
function deferredSection(records) {
  const deferred = records.filter((record) => record.status === 'deferred');
  if (deferred.length === 0) return '_Nothing is parked._';

  return deferred
    .map(
      (record) =>
        `- **${record.id}**${record.plan ? ` (${record.plan})` : ''} — ${cell(record.title)}\n` +
        `  - _${cell(record.note)}_`
    )
    .join('\n');
}

export function render(db, records) {
  assertKnownValues(records);
  const open = records.filter(
    (record) => record.status === 'open' || record.status === 'in-progress'
  );

  return `${[
    '# Work registry',
    '',
    '> ⚠️ **Generated file — do not edit.** Regenerate with `jtrek build`.',
    '>',
    '> The source of truth is [`registry.ndjson`](./registry.ndjson); this is the current',
    '> revision of every record, rendered for humans and pull-request review. To change',
    '> anything here, run `jtrek checkout`, edit `work.json`, then `jtrek checkin`.',
    '',
    '## Summary',
    '',
    summarySection(records),
    '',
    '## Open work',
    '',
    open.length > 0 ? table(RECORD_HEADER, recordRows(open)) : '_Nothing open._',
    '',
    '## Deferred — parked, with the condition that would restart it',
    '',
    deferredSection(records),
    '',
    '## Hierarchy',
    '',
    hierarchySection(db, records),
    '',
    '## Requirements in force, by feature',
    '',
    requirementsSection(db),
    '',
    '## All records',
    '',
    records.length > 0 ? table(RECORD_HEADER, recordRows(records)) : '_The store is empty._',
  ].join('\n')}\n`;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const out = store.registryMdPath;
  const specPath = path.join(store.dir, SPEC_FILENAME);
  const specText = fs.existsSync(specPath) ? readText(specPath) : null;

  const { db } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });

  let markdown;
  let spec = null;
  try {
    const records = currentRecords(db);
    markdown = render(db, records);
    if (specText !== null) spec = renderSpec(specText, records);
    // The database is written only on a real build, because `--check` is a gate and must not write
    // anything.
    if (!args.check) writeDatabase(db, store.registryDbPath);
  } finally {
    db.close();
  }

  if (!args.check) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, markdown);
    logger.info(`Wrote ${out} and ${store.registryDbPath}.`);
    // The spec is written only when its rendered part changed, so that a build leaves the file's
    // modification time alone while nobody has revised a requirement.
    if (spec !== null && spec !== specText) {
      fs.writeFileSync(specPath, spec);
      logger.info(`Rewrote the requirements in ${specPath}.`);
    }
    return 0;
  }

  const stale = [];
  const committed = fs.existsSync(out) ? readText(out) : null;
  if (committed !== markdown) stale.push(out);
  if (spec !== null && spec !== specText) stale.push(specPath);
  if (stale.length === 0) {
    logger.info(
      spec !== null
        ? `${out} and the requirements in ${specPath} match the store.`
        : `${out} matches the store.`
    );
    return 0;
  }
  throw new Error(
    `${stale.join(' and ')} ${stale.length > 1 ? 'do' : 'does'} not match the store. ` +
      `Run 'jtrek build' and commit the result.`
  );
}
