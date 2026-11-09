/**
 * src/commands/migrate.js implements `jtrek migrate`, which brings a store written against an
 * earlier schema up to the current one.
 *
 * The command rebuilds the store rather than patching it, and that choice determines its whole
 * design. It reads the existing store, builds a complete new store that satisfies the schema this
 * jtrek ships, validates the new store as a finished file, and only then replaces the old one.
 * `R-000153` made that decision. A direct write to `registry.ndjson` runs none of the checks that
 * `jtrek checkin` makes across rows. A patch would therefore have to reimplement whichever of
 * those checks apply to the field being added. A rebuild gets most of them without extra work.
 * Once the whole store is in memory, the schema enforces its constraints when the store is loaded,
 * and the result can be compared with the input line by line.
 *
 * This is a separate command, and not an exception to rule R1. R1 says that a person never writes
 * the registry. It does not say that the tool may write the registry through only one command.
 * `R-000154` changed R1's wording to say so, so a migration run by jtrek is within the rule rather
 * than excused from it. A project that adopts jtrek has no other approved way to do this.
 * `R-000133`'s permission to rewrite rows by hand applies only to jtrek's own repository. Without
 * this command, the owner of a store that stops loading could do nothing about it legitimately.
 *
 * ## What it refuses to run against
 *
 * `R-000153` left this question to the session that built the command, because only a real
 * transformation could show what needed refusing. There are three refusals, and each protects a
 * particular state:
 *
 *   1. It refuses a store already at this tool's version, because there is nothing to build. The
 *      rebuild would produce a file identical to the one on disk, and nothing would change. If any
 *      detail of serialization had changed in the meantime, it would instead rewrite the whole file
 *      without anyone asking for it. Both outcomes are worse than reporting that the store is
 *      already current.
 *   2. It refuses a store written by a newer jtrek. This copy of the tool does not know what the
 *      newer schema requires. Rebuilding against the schema it ships would drop anything it does
 *      not recognise. The tool is what is out of date, and the fix is to update it.
 *   3. It refuses a registry with uncommitted changes. The command replaces the file, and git is
 *      the only backup a store has. A row that was written but not committed could not be recovered
 *      once the file was replaced, so the migration is refused until the working tree is clean. A
 *      store that is not in git at all is not refused, because git cannot be asked about it. The
 *      run says plainly that it could not check, which is the same position `jtrek check` takes on
 *      a store outside version control.
 *
 * A migration makes the `history` check fail, and that is intended. Rebuilding rewrites every line,
 * which is exactly what that check exists to report. `R-000155` decided that nothing may exempt
 * itself from a gate. The only thing that changes is the message: `violationsIn` recognises that
 * the whole file was rewritten and suggests `--since`. Once the migration is committed, the default
 * comparison passes again, because it compares the working tree against `HEAD`.
 *
 * There is no table of steps for each version, and one would be premature. The transformation from
 * version 0 to version 1 is to write every record through the current writer. The only thing a
 * version-0 row lacks is the chain value, and the chain value is computed from the row. A later
 * version that needs a real transformation will require this command to change, and the form of
 * that change depends on what that version does.
 *
 * ## Renaming plan sections to slugs
 *
 * `jtrek migrate --plan-slugs` is a second transformation, and it changes the content of a field
 * rather than the store's format. `R-000180` decided that plan sections are named by a slug, such as
 * `plan-surface`, rather than by a number, such as `§5`, because inserting a section renumbered every
 * later one. Stores written before that decision name numbers in their `plan` values and in their
 * plan document's headings. This mode rewrites both, and `R-000183` records how it was designed.
 *
 * It takes each slug from the plan document. For every heading of the form `## §N — <title>` or
 * `## N. <title>`, the slug is derived from the title by `deriveSlug`, unless a `--slug §N=<slug>`
 * argument names it
 * instead. The derived slug of a long title is long, and the override is how a project chooses a
 * short one. The mode then rewrites the `plan` value of every row naming a number, including rows
 * that are earlier revisions, so that `jtrek history` and `jtrek query` agree with each other.
 * Finally, it rewrites each numbered heading to `## <slug> — <title>`. Nothing else in the plan is
 * touched. A `§N` in the plan's prose may refer to something other than a section, so the run lists
 * each one for a person to correct.
 *
 * It does not raise the store's format version. The schema treats `plan` as free text, so an older
 * jtrek reads a slug correctly. Raising the version would have made every store that adopts jtrek
 * run this migration before a new jtrek would load it, including stores that never used numbers.
 *
 * It runs only against a store at the current format version, and it refuses a registry or a plan
 * document with uncommitted changes, because it replaces both files. It stops without writing
 * anything when a row names a number the plan has no heading for, rather than guessing which
 * section was meant. It also stops when a row names a value that begins with `§` but is not a
 * number, when two sections would share a slug, or when a title yields no slug and no override
 * supplies one. A number is `§` followed by digits, which may end in lowercase letters, as `§7a`. Like the rebuild, it rewrites every line of the registry, so
 * the `history` check fails until the result is committed.
 *
 * `jtrek migrate --from-jtrack` is a third transformation, and `src/commands/migrate-from-jtrack.js`
 * implements it. `bin/jtrek.js` sends it there before store discovery runs, so `run` below never
 * sees that option.
 *
 * Usage:
 *   jtrek migrate                                  rebuild the store against the current schema
 *   jtrek migrate --plan-slugs [--slug §N=<slug>]  rename plan sections from numbers to slugs
 *   jtrek migrate --from-jtrack                    move a jtrack project to jtrek's names
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { NUMBERED, SLUG, deriveSlug, numberedSections, planSections } from '../plan.js';
import { targets } from './agent.js';
import {
  SCHEMA_VERSION,
  applyChain,
  chainBreaks,
  createDatabase,
  insertRecords,
  loadRegistry,
  parseRegistry,
  readVersion,
  serializeHeader,
  serializeRecord,
} from '../store.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/migrate');

export const USAGE = `
Usage: jtrek migrate
       jtrek migrate --plan-slugs [--slug §N=<slug> ...]
       jtrek migrate --from-jtrack

Without options, it rebuilds the store against the schema this jtrek ships, so a store written
before a schema change loads again. It reads what is there, builds a complete new store, validates
that new store before writing anything, and then replaces the registry.
It refuses a store that is already current, a store written by a newer jtrek, and a registry
carrying uncommitted changes.

With --plan-slugs, it renames the plan's sections from numbers such as §5 or §7a to slugs such as
plan-surface. It reads a numbered heading written as '## §5 — <title>' or as '## 5. <title>'. Each
slug is derived from the section's title unless --slug names it. It rewrites every row's 'plan'
value and every numbered heading in the plan document. It writes nothing if a row names a number
the plan has no heading for, or a value that begins with § but is not a number. It refuses a store
not at the current format version, and a registry or plan document carrying uncommitted changes.

With --from-jtrack, it brings a project that adopted jtrack under jtrek's names. It moves jtrack/,
jtrack.json and the jtrack_*.md documents to their jtrek names with git mv, rewrites the registry's
header key to jtrek_schema, and recomputes every row's chain from jtrek's seed. It refuses a chain
that does not verify against jtrack's seed, a format version other than 1, an open checkout,
uncommitted changes to the files it touches, a file it would move that git does not track, and a
project holding both names. It commits nothing.

Options:
  --plan-slugs         rename plan sections from numbers to slugs
  --slug §N=<slug>     use <slug> for section §N instead of deriving it; may be repeated
  --from-jtrack        move a jtrack project to jtrek's names; takes no other option
`.trim();

export function parseArgs(argv) {
  const args = { help: false, planSlugs: false, slugs: new Map() };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--plan-slugs':
        args.planSlugs = true;
        break;
      case '--slug': {
        const match = value?.match(/^(§\d+)=(.+)$/);
        if (!match) throw new UsageError('--slug needs a section and a slug, e.g. --slug §5=plan-surface');
        if (!SLUG.test(match[2])) {
          throw new UsageError(
            `'${match[2]}' is not a slug. A slug is lowercase letters and digits in groups joined ` +
              `by single hyphens, e.g. plan-surface.`
          );
        }
        if (args.slugs.has(match[1])) throw new UsageError(`--slug names ${match[1]} twice.`);
        args.slugs.set(match[1], match[2]);
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        return { ...args, help: true };
      default:
        throw new UsageError(`Unknown argument '${flag}'. ${USAGE}`);
    }
  }
  if (args.slugs.size > 0 && !args.planSlugs) {
    throw new UsageError(`--slug applies only with --plan-slugs.\n\n${USAGE}`);
  }
  return args;
}

/**
 * Reports whether the registry has changes that git does not yet hold.
 *
 * There are three possible answers rather than two. `clean` and `dirty` decide whether the command
 * runs. `unknown` carries the reason the question could not be answered, and it does not cause a
 * refusal. A store kept outside git, or one that was never committed, cannot answer the question.
 * Refusing such a store would leave its project unable to migrate at all. `R-0019` recorded that
 * outcome as the problem with any default that fails wherever its assumption does not hold.
 */
export function workingTreeState(registryPath) {
  const dir = path.dirname(registryPath);
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

  const toplevel = run(['rev-parse', '--show-toplevel']);
  if (toplevel.error || toplevel.status !== 0) {
    return { state: 'unknown', reason: `${dir} is not inside a git repository.` };
  }

  const tracked = run(['ls-files', '--full-name', '--', path.basename(registryPath)]);
  if (tracked.status !== 0 || (tracked.stdout ?? '').trim() === '') {
    return {
      state: 'unknown',
      reason: `${registryPath} is not tracked by git, so there is no committed copy to fall back on.`,
    };
  }

  const status = run(['status', '--porcelain', '--', registryPath]);
  if (status.error || status.status !== 0) {
    return { state: 'unknown', reason: `git could not report the status of ${registryPath}.` };
  }
  return (status.stdout ?? '').trim() === ''
    ? { state: 'clean' }
    : { state: 'dirty', reason: (status.stdout ?? '').trim() };
}

/**
 * Returns the complete text of the rebuilt store, which is the header stating the new version
 * followed by every row.
 *
 * The records are rebuilt in the order in which they were read, which is their order in the file.
 * A migration moves no row, and if one were moved, the chain values would show it. `transform`
 * returns the row a record becomes. The rebuild to a new format version passes none, because that
 * rebuild changes nothing but the chain, and `--plan-slugs` passes the one that rewrites `plan`.
 */
export function rebuild(records, transform = (record) => record) {
  // The records are copied rather than changed in place, because `applyChain` writes into the rows
  // it is given. A caller that wants to compare the result with its input still has the input.
  const rows = records.map((record) => ({ ...transform(record) }));
  applyChain(rows);
  return `${[serializeHeader(SCHEMA_VERSION), ...rows.map(serializeRecord)].join('\n')}\n`;
}

/**
 * Parses the rebuilt text and proves that it is a valid store, before anything on disk is changed.
 *
 * What matters is that the text is validated, rather than the objects in memory. The rows were
 * built in this file, so checking the objects would only confirm what this file just did. Parsing
 * the serialized text answers the question that matters, which is whether the file about to be
 * written will load. Every constraint in `schema.sql` runs, exactly as it does for any other store.
 *
 * A migration cannot repair a store that is broken for some other reason. If a row fails a
 * constraint unrelated to the version, such as a `detail_ref` that was never filled in, the
 * validation fails and nothing is written. That is the correct outcome. This command can compute a
 * value that the schema now requires, but it cannot invent content that nobody wrote.
 */
export function validateRebuilt(text, { schemaPath, count }) {
  const { version, records } = parseRegistry(text, 'the rebuilt store');

  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `The rebuilt store states version ${version} rather than ${SCHEMA_VERSION}. Nothing was ` +
        `written.`
    );
  }
  if (records.length !== count) {
    throw new Error(
      `The rebuilt store holds ${records.length} row(s) where the store read held ${count}. A ` +
        `migration adds and removes no rows. Nothing was written.`
    );
  }

  const db = createDatabase({ schemaPath });
  try {
    insertRecords(db, records);
  } finally {
    db.close();
  }

  const breaks = chainBreaks(records);
  if (breaks.length > 0) {
    throw new Error(
      `The rebuilt store's chain does not verify at row ${breaks[0].position} ` +
        `(${breaks[0].id} rev ${breaks[0].rev}). Nothing was written.`
    );
  }

  return records;
}

/**
 * Returns every field that differs between a record as it was read and the same record as it was
 * rebuilt.
 *
 * This is the one requirement that a rebuild does not satisfy automatically. Every part of a row
 * that the migration does not intend to change must come out byte for byte the same. `R-000133`
 * records that both earlier rewrites in place met this requirement by checking by hand. Holding the
 * input and the output side by side turns it into an ordinary comparison. This comparison is what
 * would catch an unintended change to serialization, such as a reordered field, a dropped null or a
 * number formatted differently.
 */
export function unexpectedChanges(before, after, allowed) {
  const problems = [];
  for (let index = 0; index < before.length; index += 1) {
    const was = before[index];
    const is = after[index];
    for (const key of Object.keys({ ...was, ...is })) {
      if (allowed.includes(key)) continue;
      if (JSON.stringify(was[key] ?? null) === JSON.stringify(is[key] ?? null)) continue;
      problems.push(`${is.id ?? was.id} rev ${is.rev ?? was.rev}: '${key}' changed.`);
    }
  }
  return problems;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (!fs.existsSync(store.registryPath)) {
    throw new Error(`No registry at ${store.registryPath}. Run 'jtrek init' to create a store.`);
  }
  if (args.planSlugs) return renamePlanSections(store, args.slugs);

  // The version is read from line 1 before the rows are parsed. A store written by a newer jtrek
  // may have a column that this one does not recognise. Parsing the rows first would report that
  // column, rather than the version mismatch that explains it.
  const text = readText(store.registryPath);
  const stated = statedVersion(text);

  if (stated > SCHEMA_VERSION) throw newerStore(store, stated);
  if (stated === SCHEMA_VERSION) {
    logger.info(
      `${store.registryPath} is already at store format version ${SCHEMA_VERSION}. Nothing to ` +
        `migrate, and nothing was written.`
    );
    return 0;
  }

  requireCommitted(store.registryPath);

  // `loadRegistry` parses each row and checks its shape without applying the schema. That is what
  // allows an old store to be read at all. Its rows do not satisfy the current schema, which is the
  // reason this command exists.
  const { records } = loadRegistry({ registryPath: store.registryPath });
  logger.info(
    `Read ${records.length} row(s) at store format version ${stated}. Building a store at ` +
      `version ${SCHEMA_VERSION}.`
  );

  const rebuilt = rebuild(records);
  const after = validateRebuilt(rebuilt, { schemaPath: store.schemaPath, count: records.length });

  // The migration from version 0 to version 1 adds the chain value and changes nothing else, so the
  // chain is the only field allowed to differ. A later version that transforms a field would add
  // that field to this list.
  const problems = unexpectedChanges(records, after, ['chain']);
  if (problems.length > 0) {
    throw new Error(
      `The rebuilt store differs from what was read in ${problems.length} place(s) beyond the ` +
        `field this migration adds. Nothing was written:\n  - ${problems.join('\n  - ')}`
    );
  }

  fs.writeFileSync(store.registryPath, rebuilt);

  logger.info(`Wrote ${store.registryPath}: ${after.length} row(s), every one chained to the row before it.`);
  logger.info(
    `⚠️ This rewrote every line, so 'jtrek check' reports the history group as FAILED until the ` +
      `rebuild is committed. That is the gate working rather than a fault. Commit the store, ` +
      `after which the default comparison against HEAD is clean; to verify a range that spans the ` +
      `rebuild, pass 'jtrek check --since <the commit that made it>'.`
  );
  logger.info("Run 'jtrek build' next, then commit the store.");

  return 0;
}

/** The error for a store written by a newer jtrek, which neither kind of migration may touch. */
function newerStore(store, stated) {
  return new Error(
    `${store.registryPath} is at store format version ${stated}, and this jtrek reads version ` +
      `${SCHEMA_VERSION}. It was written by a newer jtrek than this one, so rebuilding it here ` +
      `would drop whatever that version added and this one has never heard of. Update jtrek ` +
      `rather than migrating the store.`
  );
}

/**
 * Refuses to go on when a file the migration is about to replace has changes git does not hold.
 *
 * When git cannot be asked, the run goes on and says so, for the reason `workingTreeState` gives.
 */
function requireCommitted(file) {
  const tree = workingTreeState(file);
  if (tree.state === 'dirty') {
    throw new Error(
      `${file} has changes git does not hold, so this migration is refused. It rewrites the whole ` +
        `file, and git is the only backup a store has — an uncommitted change would be gone with ` +
        `no way back. Commit or stash the change, then run this again:\n  ${tree.reason}`
    );
  }
  if (tree.state === 'unknown') {
    logger.info(`Could not check for uncommitted changes — ${tree.reason}`);
    logger.info('The migration replaces this file, so take a copy first if nothing else holds one.');
  }
}

/**
 * Returns the slug that replaces each numbered section of the plan, as a map from number to slug.
 *
 * It throws, and so stops the migration before anything is written, when a section's slug cannot be
 * settled: a number appears in two headings, an override names a number the plan has no heading
 * for, a title yields no slug and no override supplies one, or two sections would share a slug. A
 * section that already has a slug counts towards the last test, because a plan may have gained a
 * section by slug before its older sections were migrated.
 */
export function slugMapping(planText, overrides) {
  const numbered = numberedSections(planText);
  const problems = [];
  const mapping = new Map();

  for (const section of numbered) {
    if (mapping.has(section.marker)) {
      problems.push(`${section.marker} heads two sections, so a row naming it could mean either.`);
      continue;
    }
    const slug = overrides.get(section.marker) ?? (section.title ? deriveSlug(section.title) : null);
    if (slug === null) {
      problems.push(
        `${section.marker} has no title a slug can be derived from. Name one with ` +
          `--slug ${section.marker}=<slug>.`
      );
      continue;
    }
    mapping.set(section.marker, slug);
  }

  for (const marker of overrides.keys()) {
    if (!numbered.some((section) => section.marker === marker)) {
      problems.push(`--slug names ${marker}, but the plan has no heading for it.`);
    }
  }

  const owners = new Map();
  for (const slug of planSections(planText).keys()) owners.set(slug, [`the section already named ${slug}`]);
  for (const [marker, slug] of mapping) owners.set(slug, [...(owners.get(slug) ?? []), marker]);
  for (const [slug, claimants] of owners) {
    if (claimants.length > 1) {
      problems.push(`'${slug}' would name ${claimants.join(' and ')}. Give one of them another with --slug.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The plan's sections cannot all be given slugs, so nothing was written:\n  - ` +
        problems.join('\n  - ')
    );
  }
  return mapping;
}

/**
 * Returns the plan document's text with every numbered heading replaced by `## <slug> — <title>`.
 *
 * Each heading line is replaced exactly, and nothing else in the file changes. The result is read
 * back with `planSections`, so that a heading this function wrote but `jtrek start` could not read
 * stops the migration rather than being discovered later.
 */
export function renameHeadings(planText, mapping) {
  let text = planText;
  const numbered = numberedSections(planText);
  // Each heading is replaced at the position where it was found, rather than by searching for its
  // text. A search finds the first occurrence, which can be an earlier line that begins with the
  // same text, such as `## §1x draft` above `## §1` (`R-000625`). The headings are replaced from
  // the last to the first, so that a replacement never moves the position of one still to come.
  for (const section of [...numbered].reverse()) {
    const slug = mapping.get(section.marker);
    const title = section.title ?? slug;
    const end = section.index + section.line.length;
    text = `${text.slice(0, section.index)}## ${slug} — ${title}${text.slice(end)}`;
  }

  const read = planSections(text);
  for (const section of numbered) {
    if (!read.has(mapping.get(section.marker))) {
      throw new Error(
        `The rewritten heading for ${section.marker} does not read back as a section named ` +
          `'${mapping.get(section.marker)}'. Nothing was written.`
      );
    }
  }
  return text;
}

/** Lists each line of the plan that still contains a `§N` after its headings were rewritten. */
function remainingNumbers(planText) {
  return planText
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /§\d+/.test(line))
    .map(({ line, number }) => `line ${number}: ${line.trim().slice(0, 100)}`);
}

/**
 * Returns the format version that a registry's text states, before its rows are parsed.
 *
 * A header states the version. A registry with no header is version 0 when it holds rows, but a
 * registry with no rows and no header is current (`R-000306`), because nothing in it was written
 * against an earlier schema. `assertVersion` applies the same rule when a store loads, so both
 * ways of the migration agree with every other command about an empty store (`R-000622`).
 */
function statedVersion(text) {
  const version = readVersion(text);
  if (version !== null) return version;
  return text.split('\n').some((line) => line.trim() !== '') ? 0 : SCHEMA_VERSION;
}

/**
 * Carries out `jtrek migrate --plan-slugs`. The comment at the top of this file says what it does
 * and what it refuses.
 */
function renamePlanSections(store, overrides) {
  const text = readText(store.registryPath);
  const stated = statedVersion(text);
  if (stated > SCHEMA_VERSION) throw newerStore(store, stated);
  if (stated < SCHEMA_VERSION) {
    throw new Error(
      `${store.registryPath} is at store format version ${stated}, and plan sections can only be ` +
        `renamed in a store at version ${SCHEMA_VERSION}. Run 'jtrek migrate' first.`
    );
  }

  const planDoc = targets(store).planDoc;
  if (!fs.existsSync(planDoc)) {
    throw new Error(`No plan document at ${planDoc}, so there are no sections to take slugs from.`);
  }
  const planText = readText(planDoc);
  const mapping = slugMapping(planText, overrides);

  const { records } = loadRegistry({ registryPath: store.registryPath });
  // A value that begins with § but is not a number this command recognises would otherwise be left
  // as it is while the run reported success, and every row naming it would then name no section
  // (`R-000660`). The run therefore stops and names each such value, so that a person can decide
  // which section was meant.
  const unrecognised = new Map();
  for (const record of records) {
    const plan = record.plan ?? '';
    if (!plan.startsWith('§') || NUMBERED.test(plan)) continue;
    unrecognised.set(plan, [...new Set([...(unrecognised.get(plan) ?? []), record.id])]);
  }
  if (unrecognised.size > 0) {
    throw new Error(
      `Some rows name a plan value that begins with § but is not a section number this command ` +
        `recognises, which is § followed by digits and optionally by lowercase letters. Nothing was ` +
        `written. Correct the records, then run this again:\n  - ` +
        [...unrecognised].map(([value, ids]) => `${value}: ${ids.join(', ')}`).join('\n  - ')
    );
  }

  const numberedRows = records.filter((record) => NUMBERED.test(record.plan ?? ''));
  const unmapped = new Map();
  for (const record of numberedRows) {
    if (mapping.has(record.plan)) continue;
    unmapped.set(record.plan, [...new Set([...(unmapped.get(record.plan) ?? []), record.id])]);
  }
  if (unmapped.size > 0) {
    throw new Error(
      `Some rows name a plan section that ${planDoc} has no numbered heading for, so there is no ` +
        `slug to give them and nothing was written. Add the missing heading, or correct the ` +
        `records, then run this again:\n  - ` +
        [...unmapped].map(([marker, ids]) => `${marker}: ${ids.join(', ')}`).join('\n  - ')
    );
  }

  if (mapping.size === 0) {
    logger.info(
      `${planDoc} has no numbered headings and no row names a number. Nothing to migrate, and ` +
        `nothing was written.`
    );
    return 0;
  }

  requireCommitted(store.registryPath);
  requireCommitted(planDoc);

  const rename = (record) =>
    NUMBERED.test(record.plan ?? '') ? { ...record, plan: mapping.get(record.plan) } : record;
  const intended = records.map(rename);
  const rebuilt = rebuild(records, rename);
  const after = validateRebuilt(rebuilt, { schemaPath: store.schemaPath, count: records.length });

  // The rows are compared with what this migration intended rather than with what was read. That
  // comparison proves both halves at once: every `plan` value became the slug it was meant to, and
  // no other field moved.
  const problems = unexpectedChanges(intended, after, ['chain']);
  if (problems.length > 0) {
    throw new Error(
      `The rebuilt store differs from what this migration intended in ${problems.length} ` +
        `place(s). Nothing was written:\n  - ${problems.join('\n  - ')}`
    );
  }
  const newPlan = renameHeadings(planText, mapping);

  fs.writeFileSync(store.registryPath, rebuilt);
  fs.writeFileSync(planDoc, newPlan);

  logger.info(
    `Renamed ${mapping.size} plan section(s):\n  ` +
      [...mapping].map(([marker, slug]) => `${marker} → ${slug}`).join('\n  ')
  );
  logger.info(
    `Wrote ${store.registryPath}: ${numberedRows.length} of ${after.length} row(s) now name a slug, ` +
      `and every row is chained again.`
  );
  logger.info(`Wrote ${planDoc}: its numbered headings now begin with their slugs.`);
  const leftover = remainingNumbers(newPlan);
  if (leftover.length > 0) {
    logger.info(
      `The plan's prose still contains a section number in ${leftover.length} place(s). They were ` +
        `left alone, because a number in prose may not refer to a plan section. Correct each one by ` +
        `hand:\n  ${leftover.join('\n  ')}`
    );
  }
  logger.info(
    `⚠️ This rewrote every line of the registry, so 'jtrek check' reports the history group as ` +
      `FAILED until the change is committed. Prose files keep the section numbers they were ` +
      `written with. Run 'jtrek build' next, then commit the store and the plan.`
  );

  return 0;
}
