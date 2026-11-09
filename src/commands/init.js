/**
 * src/commands/init.js implements `jtrek init`, which makes a project's store usable by jtrek
 * without ever replacing an existing store.
 *
 * The command has two outcomes, and only one of them can apply to a given run. Where there is no
 * store, `init` creates one. Where there is a store, `init` adopts it. Adopting means loading every
 * row against the schema this jtrek ships, reporting what was found, and recording the store's
 * location in `jtrek.json`. Creation runs only when no store was found, so no path through this
 * file can write over a registry.
 *
 * This is the one command that could destroy months of work. The store jtrek was extracted from
 * holds roughly 450 real records, and git is its only backup. Four safeguards stand between that
 * store and a mistake:
 *
 *   1. `registry.ndjson` is created with the exclusive `wx` flag. If a logic error ever reached the
 *      creation step while a store already existed, opening the file would fail rather than empty
 *      it.
 *   2. A directory that exists and holds files but has no `registry.ndjson` is refused, rather than
 *      built on. A store whose registry was deleted or moved looks exactly like that. Creating a
 *      store in that directory would leave the old records stranded beside a new, empty log.
 *   3. A `jtrek.json` that already names a different store is refused, rather than changed to
 *      point at this one.
 *   4. The configuration is decided before anything is written, so a refusal never leaves the work
 *      half done.
 *
 * Adopting a store is not migrating it. Loading checks the store's format version before reading
 * any row, so a store at a different version is refused rather than adopted, and `init` changes
 * nothing to fix it. A store older than this jtrek is rebuilt by `jtrek migrate`, after which
 * `init` can adopt it. A store written by a newer jtrek instead requires this copy of the tool to
 * be updated. The refusal prints the remedy for whichever case it met, rather than the remedy for a
 * bad row, as `R-000158` found necessary.
 *
 * Adopting a store is also not an integrity check. Loading proves that the rows are well formed.
 * It does not prove that every `detail_ref` resolves, or that every prose file was written. Those
 * are separate questions, and this command does not answer them.
 *
 * Usage:
 *   jtrek init                      adopt the store discovery finds, or create one
 *   jtrek init --store <dir>        use this directory, without walking up to look for another
 */

import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import {
  CONFIG_FILENAME,
  REGISTRY_FILENAME,
  STORE_DIR_CANDIDATES,
  findStore,
  isStore,
  readConfig,
  storeAt,
} from '../discovery.js';
import { StoreVersionError, currentRecords, openStore, serializeHeader } from '../store.js';

const logger = createLogger('jtrek/init');

export const USAGE = `
Usage: jtrek init [--store <dir>]

Creates a store where there is none, and adopts the one already there where there is. Either way
it writes ${CONFIG_FILENAME}, naming the store so discovery cannot later settle on a different one.

Options:
  --store <dir>   the directory to use, relative to the working directory. Without it, init adopts
                  whatever store discovery finds, and creates ${STORE_DIR_CANDIDATES[0]}/ when it finds none.

An existing store is never written to, and a directory holding files but no ${REGISTRY_FILENAME}
is refused rather than built on.
`.trim();

/**
 * The files a new store starts with, beyond the registry itself.
 *
 * `records/` holds the prose files that a `detail_ref` points at. Git cannot store an empty
 * directory. Without a placeholder file, a fresh clone would therefore arrive without the
 * directory, and the first check-in would try to use prose files in a path that does not exist.
 *
 * The ignore file lists what is derived and what is temporary. `registry.db` is a view of the log
 * that nothing may read back. Committing it would give the store a second source of truth, which
 * the append-only design exists to prevent. `work.json` is one session's checkout.
 */
const GITIGNORE = `# Generated from ${REGISTRY_FILENAME} by 'jtrek build', and never read back.
registry.db

# The checkout in progress. Written by 'jtrek checkout', consumed by 'jtrek checkin'.
work.json
`;

export function parseArgs(argv) {
  const args = { store: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--store') {
      if (!argv[i + 1]) throw new UsageError(`--store needs a directory, e.g. --store ${STORE_DIR_CANDIDATES[0]}`);
      args.store = argv[i + 1];
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      return { ...args, help: true };
    } else {
      throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }

  return args;
}

/**
 * Decides which store this run is about.
 *
 * With `--store`, the function does not walk up through the parent directories. The user has said
 * where the store is. Searching the parent directories after being told could make `init` adopt a
 * store somewhere else entirely, which is the one outcome the flag exists to rule out.
 *
 * Without the flag, store discovery decides. `mustExist: false` lets discovery return nothing,
 * rather than refusing `init` because no store exists, when creating a store is what `init` is for.
 * Discovery may also return a directory that holds no registry. That happens when a `jtrek.json`
 * names a store that has not been created yet, or when `JTREK_STORE` points at an empty directory.
 * Such a directory is a place to create a store. Both branches below therefore lead to the same
 * decision in `run`.
 */
export function resolveTarget(args, { cwd = process.cwd(), env = process.env } = {}) {
  if (args.store) {
    return storeAt(path.resolve(cwd, args.store), { source: '--store', projectRoot: cwd });
  }

  const found = findStore({ cwd, env, mustExist: false });
  if (found) return found;

  return storeAt(path.join(cwd, STORE_DIR_CANDIDATES[0]), {
    source: 'the default for a new store',
    projectRoot: cwd,
  });
}

/**
 * Decides what `jtrek.json` should say, and refuses immediately if it already says something
 * else.
 *
 * Deciding is kept separate from writing, so that a refusal leaves nothing to undo. Both outcomes
 * touch the store: one creates it and the other opens it. A conflict discovered after that would
 * leave a store created while the project still points somewhere else. Every reason to refuse is
 * therefore found here, before anything is written.
 */
export function planConfig(store) {
  const configPath = path.join(store.projectRoot, CONFIG_FILENAME);
  const relative = path.relative(store.projectRoot, store.dir) || '.';
  const existing = readConfig(configPath);

  if (existing === null) return { configPath, relative, content: { store: relative }, what: 'created' };

  // A configuration file with no `store` key does not name any store, so adding the key does not
  // redirect anything.
  if (existing.store === undefined) {
    return { configPath, relative, content: { store: relative, ...existing }, what: 'updated' };
  }

  if (path.resolve(store.projectRoot, existing.store) === path.resolve(store.dir)) {
    return { configPath, relative, content: null, what: 'unchanged' };
  }

  throw new Error(
    `${configPath} already names '${existing.store}' as the store, and init will not repoint it ` +
      `at '${relative}'. Two stores in one project is a decision, not something a setup command ` +
      `should make: edit ${CONFIG_FILENAME} by hand, or run init from the project the other store ` +
      `belongs to.`
  );
}

function applyConfig(plan) {
  if (plan.what === 'unchanged') {
    logger.info(`${plan.configPath} already names '${plan.relative}' — left as it is.`);
    return;
  }
  fs.writeFileSync(plan.configPath, `${JSON.stringify(plan.content, null, 2)}\n`);
  logger.info(`${plan.what === 'created' ? 'Wrote' : 'Updated'} ${plan.configPath}, naming the store '${plan.relative}'.`);
}

/**
 * Returns true for a directory that exists, holds something and has no registry. Such a directory
 * is probably a store that has lost its log.
 */
function looksLikeALostStore(dir) {
  return fs.existsSync(dir) && !isStore(dir) && fs.readdirSync(dir).length > 0;
}

function refuseLostStore(dir) {
  throw new Error(
    `${dir} exists and holds ${fs.readdirSync(dir).length} file(s), but there is no ` +
      `${REGISTRY_FILENAME} in it. jtrek will not create a store while that is true — a store ` +
      `whose registry was deleted, moved or never committed looks exactly like this, and a new ` +
      `empty log would leave those records stranded beside it with nothing pointing at them. ` +
      `Restore the registry, or move the directory aside, then run init again. To create a store ` +
      `anyway, name where it goes with --store.`
  );
}

/**
 * Creates a store where there is none.
 *
 * Two directories are checked, not one. The obvious hazard is that the target directory already
 * holds files. The hazard more likely to cause harm is less visible. A project whose `jtrek/`
 * directory has lost its `registry.ndjson` has no store there, so discovery walks past it. `init`
 * would then create a second store elsewhere, leaving the old records orphaned without telling
 * anyone. The directories that discovery checks for are therefore checked here too, and a run
 * without `--store` stops if either check finds such a directory. `--store` skips the second
 * check, because naming the directory tells jtrek that the user has chosen the arrangement
 * deliberately.
 *
 * The real guarantee is the `wx` flag on the registry, not the checks above it. A check can be
 * defeated by a race between two processes, or by a later change that sends a second caller down
 * this branch. An exclusive open cannot be defeated in those ways, because the filesystem itself
 * refuses it.
 */
function create(store, { explicitTarget }) {
  if (looksLikeALostStore(store.dir)) refuseLostStore(store.dir);

  if (!explicitTarget) {
    for (const candidate of STORE_DIR_CANDIDATES) {
      const dir = path.join(store.projectRoot, candidate);
      if (dir !== store.dir && looksLikeALostStore(dir)) refuseLostStore(dir);
    }
  }

  fs.mkdirSync(store.dir, { recursive: true });
  // The registry begins with the header line stating the format version, and every row is
  // appended after it. A new store states its version outright, rather than leaving a reader to
  // infer it from a missing header. Writing the header here also exercises the code that writes
  // it. The only other code that writes a header is `jtrek migrate`, when it rebuilds a store, and
  // a migration is the worst moment to discover a fault in that code.
  fs.writeFileSync(store.registryPath, `${serializeHeader()}\n`, { flag: 'wx' });
  fs.mkdirSync(store.recordsDir, { recursive: true });
  fs.writeFileSync(path.join(store.recordsDir, '.gitkeep'), '');
  fs.writeFileSync(path.join(store.dir, '.gitignore'), GITIGNORE);

  logger.info(
    `Created a store at ${store.dir}: a ${REGISTRY_FILENAME} holding no records, records/, .gitignore.`
  );
  logger.info("Commit it, then start with 'jtrek checkout' — or 'jtrek agent install' first, to");
  logger.info('teach the agent driving this project how the store is meant to be used.');
}

/**
 * Returns the advice that `adopt` prints after a store fails to load, chosen according to the kind
 * of failure.
 *
 * The error itself is printed after this advice and carries the details. The advice says what to
 * do about it.
 */
export function adoptionRemedy(error) {
  if (error instanceof StoreVersionError && error.direction === 'older') {
    return "The store predates this jtrek's schema: run 'jtrek migrate', then 'jtrek init' again.";
  }
  if (error instanceof StoreVersionError) {
    return 'The store was written by a newer jtrek: update jtrek, then run init again.';
  }
  return 'Fix the row named above, or point init at another store.';
}

/**
 * Adopts the store that already exists. It reads the store, reports what is in it, and writes
 * nothing to it.
 *
 * Loading the whole registry is the test for adoption. `openStore` inserts every row into a new
 * database built from the shipped `schema.sql`. A malformed line, a value outside an allowed set, a
 * duplicate `(id, rev)` pair or an unknown field therefore fails here, and the error names the line
 * it came from. This jtrek must not operate on a store it cannot read. Reporting that now, rather
 * than letting the first real command discover it, is the reason for having an adoption step.
 *
 * A store at a different format version also fails here, and the remedy for it differs from the
 * remedy for a bad row. `openStore` checks the version before reading any row, so no row is named,
 * and neither fixing a row nor choosing another store would help. `adoptionRemedy` chooses the
 * advice that fits the failure that was caught. Whichever advice is chosen, it is printed after
 * "Nothing was written", which every refusal from this command must be able to say.
 */
function adopt(store) {
  logger.info(`Found a store at ${store.dir} (${store.source}) — adopting it.`);

  let opened;
  try {
    opened = openStore({ registryPath: store.registryPath, schemaPath: store.schemaPath });
  } catch (error) {
    logger.error(`The store at ${store.dir} did not load, so jtrek has not adopted it.`);
    logger.error(`Nothing was written. ${adoptionRemedy(error)}`);
    throw error;
  }

  try {
    const rows = opened.records.length;
    const folded = currentRecords(opened.db).length;
    logger.info(`${rows} row(s), folding to ${folded} record(s). Every row loads against this jtrek's schema.`);
  } finally {
    opened.db.close();
  }

  // These are the files a store normally has beside its registry, each with what its absence
  // means. A missing file is reported rather than created, because the store belongs to the
  // project and `init` has no right to add to it.
  const missing = [
    [store.recordsDir, 'records/', "the prose a detail_ref points at; 'jtrek checkin' expects it"],
    [store.registryMdPath, 'registry.md', "generated by 'jtrek build'"],
  ].filter(([target]) => !fs.existsSync(target));

  for (const [, name, why] of missing) logger.info(`No ${name} — ${why}.`);

  logger.info('Nothing in the store was modified.');
}

export function run(argv, options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const store = resolveTarget(args, options);
  const plan = planConfig(store);

  if (isStore(store.dir)) adopt(store);
  else create(store, { explicitTarget: args.store !== null });

  applyConfig(plan);
  return 0;
}
