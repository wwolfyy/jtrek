/**
 * src/commands/migrate-from-jtrack.js implements `jtrek migrate --from-jtrack`, which brings a
 * project that adopted jtrack under jtrek's names.
 *
 * The tool was called jtrack until it was renamed to jtrek (`R-000544`, `R-000545`). A project
 * that adopted it holds two kinds of name that the rename changed. The first kind is the names of
 * its files: the store directory `jtrack/`, the configuration file `jtrack.json`, and the
 * documents `jtrack_plan.md`, `jtrack_spec.md`, `jtrack_handoff.md` and `jtrack_architecture.md`
 * inside the store directory. The second kind is written inside `registry.ndjson`. Its first line
 * is a header whose key is `jtrack_schema`, and every row's chain value was computed from the seed
 * `jtrack/chain/v1`. `R-000600` decided that jtrek's code holds only the new names, so jtrek can
 * read such a project only once both kinds have been changed. Discovery refuses a project under
 * the old file names (`R-000595`), and a registry with the old header does not load at all.
 *
 * This command therefore makes both changes. It moves each file with `git mv`, so that git records
 * a rename and keeps the file's history. It rewrites the header key, and it recomputes every row's
 * chain value from jtrek's seed. Nothing else in any row changes. The text of the records still
 * says jtrack, and `R-000602` has `jtrek agent install` explain that text to the project's agent.
 *
 * The command runs before store discovery rather than after it, because discovery refuses the very
 * projects this command exists for. `bin/jtrek.js` therefore sends `migrate --from-jtrack` here
 * without a store, and this file finds the project itself. It walks up from the working directory
 * and stops at the first directory that holds a store or a configuration file under either name.
 *
 * Every check runs before anything is moved or written, so a refusal leaves the project exactly as
 * it was. The command refuses in these cases:
 *
 *   - A project holds both a jtrack name and the matching jtrek name (`R-000611`). The command
 *     cannot tell which of the two holds the real store. A `jtrek/` directory with no registry
 *     counts, because `git mv` would move `jtrack/` inside it.
 *   - The jtrack store is at a format version other than 1 (`R-000608`). Every jtrack release
 *     wrote version 1, and a store without a header is brought there by `jtrack migrate`.
 *   - `work.json` holds a checkout that has not been checked in (`R-000610`). Its rows were read
 *     from the registry before the rewrite, and it is gitignored, so the next check does not see it.
 *   - A file the command would move or rewrite has uncommitted changes (`R-000609`). Git is the
 *     only backup a store has.
 *   - A file the command would move is not tracked by git, for example because git ignores it
 *     (`R-000624`). `git mv` refuses such a file, and it would do so after the earlier moves.
 *   - A row's chain value does not verify against jtrack's seed (`R-000607`). Recomputing the
 *     chain without this check would give an edited row a valid value, and the evidence would be
 *     lost.
 *   - The rewritten registry would not load through the schema (`R-000613`).
 *
 * A project whose files already carry their jtrek names, but whose registry still states the old
 * header, has only its registry rewritten (`R-000606`). jtrek's own repository was in that state
 * after `R-000545`. A store directory that the configuration file names keeps its name, because the
 * project chose that name rather than jtrack (`R-000612`). The exception is a configuration that
 * names `jtrack/`, which `jtrack init` wrote by default. That directory moves to `jtrek/`, and the
 * configuration is rewritten to name it (`R-000628`).
 *
 * The command commits nothing. It says so when it finishes, together with the fact that the
 * `history` check does not pass until the migration is committed, and that `jtrek agent install`
 * comes next (`R-000614`).
 *
 * Usage:
 *   jtrek migrate --from-jtrack
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CONFIG_FILENAME,
  FORMER_CONFIG_FILENAME,
  FORMER_STORE_DIR,
  REGISTRY_FILENAME,
  SCHEMA_PATH,
  STORE_DIR_CANDIDATES,
  ancestors,
  isStore,
  readConfig,
} from '../discovery.js';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { SCHEMA_VERSION, VERSION_KEY, chainBreaks, parseRegistry } from '../store.js';
import { readText } from '../text.js';
import { rebuild, unexpectedChanges, validateRebuilt } from './migrate.js';

const logger = createLogger('jtrek/migrate');

/** The header key and the chain seed that every jtrack store was written with. */
const FORMER_VERSION_KEY = 'jtrack_schema';
const FORMER_CHAIN_SEED = 'jtrack/chain/v1';

/** The version every jtrack release wrote, and the only one this command migrates. */
const FORMER_SCHEMA_VERSION = 1;

/** The documents inside the store directory whose names begin with the tool's name. */
const DOCUMENTS = ['plan', 'spec', 'handoff', 'architecture'];

const NEW_STORE_DIR = STORE_DIR_CANDIDATES[0];

/**
 * Returns the nearest directory, from `cwd` upwards, that holds a store or a configuration file
 * under either the jtrack names or the jtrek names. It returns null when there is none.
 */
function findProject(cwd) {
  const names = [CONFIG_FILENAME, FORMER_CONFIG_FILENAME];
  return (
    ancestors(cwd).find(
      (dir) =>
        names.some((name) => fs.existsSync(path.join(dir, name))) ||
        isStore(path.join(dir, NEW_STORE_DIR)) ||
        isStore(path.join(dir, FORMER_STORE_DIR))
    ) ?? null
  );
}

/**
 * Works out what the migration of the project at `root` would move, and where its registry is.
 *
 * It returns the moves in the order they have to run. The store directory moves before the
 * documents, so each document's move is stated with the directory's new name. Each move also names
 * the path its file has now, as `current`, because that is the path git is asked about before
 * anything moves. It throws, naming both paths, when a project holds an old name beside the
 * matching new one.
 */
function planMoves(root) {
  const conflicts = [];
  const moves = [];
  // A file is moved when only its jtrack name exists, and is a conflict when both of its names
  // exist. `exists` differs for the old store directory, which counts only when it holds a
  // registry. The new name is a conflict whenever anything exists there, even a directory that
  // holds no registry, because `git mv` would then move the old directory inside it (`R-000624`).
  // `move` is passed separately because a document's move names the store directory's new path,
  // whereas its existence is checked at the path it has now.
  const planMove = (current, renamed, move, exists = fs.existsSync) => {
    if (!exists(current)) return;
    if (fs.existsSync(renamed)) conflicts.push(`${current} and ${renamed}`);
    else moves.push(move);
  };

  const oldConfig = path.join(root, FORMER_CONFIG_FILENAME);
  const newConfig = path.join(root, CONFIG_FILENAME);
  planMove(oldConfig, newConfig, { from: oldConfig, to: newConfig, current: oldConfig });
  const config = readConfig(oldConfig) ?? readConfig(newConfig) ?? {};

  // A store directory that the configuration names keeps its name, so only the default directory is
  // ever moved. `jtrack init` wrote the default directory's name into the configuration, so a
  // configuration naming `jtrack/` names the default rather than a name the project chose
  // (`R-000628`). That directory is moved like an unnamed one, and the configuration is rewritten
  // to name the new directory, because otherwise it would still send jtrek to `jtrack/`.
  const oldStore = path.join(root, FORMER_STORE_DIR);
  const namesDefault = config.store === undefined || path.resolve(root, config.store) === oldStore;
  let storeDir;
  let configRewrite = null;
  if (!namesDefault) {
    storeDir = path.resolve(root, config.store);
  } else {
    const newStore = path.join(root, NEW_STORE_DIR);
    planMove(oldStore, newStore, { from: oldStore, to: newStore, current: oldStore }, isStore);
    storeDir = isStore(oldStore) ? oldStore : newStore;
    if (config.store !== undefined) {
      configRewrite = {
        current: fs.existsSync(oldConfig) ? oldConfig : newConfig,
        path: newConfig,
        content: { ...config, store: NEW_STORE_DIR },
      };
    }
  }

  const finalDir = moves.find((move) => move.from === storeDir)?.to ?? storeDir;
  for (const doc of DOCUMENTS) {
    const current = path.join(storeDir, `jtrack_${doc}.md`);
    planMove(current, path.join(storeDir, `jtrek_${doc}.md`), {
      from: path.join(finalDir, `jtrack_${doc}.md`),
      to: path.join(finalDir, `jtrek_${doc}.md`),
      current,
    });
  }

  if (conflicts.length > 0) {
    throw new Error(
      `This project holds both the jtrack name and the jtrek name of the same file, so it cannot ` +
        `tell which one is the project's own, and nothing was written. Remove or merge one of each ` +
        `pair, then run this again:\n  - ${conflicts.join('\n  - ')}`
    );
  }
  if (!isStore(storeDir)) {
    throw new Error(`No store at ${storeDir}, so there is nothing to migrate from jtrack.`);
  }
  return { moves, storeDir, finalDir, configRewrite };
}

/**
 * Reads the registry's header and rows. It returns `current: true` when the header already states
 * jtrek's key, and otherwise the rows to be rewritten.
 *
 * It throws when the store is at a format version other than the one every jtrack release wrote.
 */
function readFormerRegistry(registryPath) {
  const text = readText(registryPath);
  const [first, ...rest] = text.split('\n');
  // An empty first line holds no header, so the store is read as having none.
  let header = null;
  try {
    if (first.trim() !== '') header = JSON.parse(first);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // A first line that is not JSON is neither a header nor a row. It is reported as malformed
    // rather than as a missing header, because the hint for a missing header would send the owner
    // to a migration that cannot help (`R-000629`).
    throw new Error(
      `${registryPath}:1 is not valid JSON, so it is neither the store's header nor a row, and ` +
        `nothing was written: ${error.message}`,
      { cause: error }
    );
  }

  const hasKey = (key) => header !== null && typeof header === 'object' && Object.hasOwn(header, key);
  if (hasKey(VERSION_KEY)) {
    // A header that already states jtrek's key is current only at jtrek's own version. At any
    // other version, the files would be moved into a store that jtrek then refuses (`R-000631`).
    if (header[VERSION_KEY] !== SCHEMA_VERSION) {
      throw new Error(
        `${registryPath} states ${VERSION_KEY} at format version ${JSON.stringify(header[VERSION_KEY])}, ` +
          `and this jtrek reads only version ${SCHEMA_VERSION}. Nothing was written.`
      );
    }
    return { current: true };
  }
  // The hint about a missing header is given only when there is no header. A header that states
  // version 0 has a header, so it is told only its version (`R-000608`).
  const stated = hasKey(FORMER_VERSION_KEY);
  const version = stated ? header[FORMER_VERSION_KEY] : 0;
  if (version !== FORMER_SCHEMA_VERSION) {
    const hint = stated
      ? ''
      : ` A store with no header is older than format version ${FORMER_SCHEMA_VERSION}. Run ` +
        `'jtrack migrate' from a jtrack release first, then run this again.`;
    throw new Error(
      `${registryPath} is a jtrack store at format version ${JSON.stringify(version)}, and this ` +
        `command migrates only version ${FORMER_SCHEMA_VERSION}. Nothing was written.${hint}`
    );
  }

  // Line 1 is replaced by an empty line rather than removed. `parseRegistry` skips an empty line,
  // and keeping it in place means that every line number in an error is the line's number in the
  // file (`R-000630`).
  const { records } = parseRegistry(['', ...rest].join('\n'), registryPath);
  return { current: false, records };
}

/** Throws when `work.json` in the store directory holds a checkout that was not checked in. */
function requireNoOpenCheckout(storeDir) {
  const workPath = path.join(storeDir, 'work.json');
  if (!fs.existsSync(workPath)) return;
  const work = JSON.parse(readText(workPath));
  if (!work.checked_in) {
    throw new Error(
      `${workPath} holds a checkout that has not been checked in, and its edits exist nowhere ` +
        `else. Its rows were also read from the registry this command rewrites. Check it in with the ` +
        `release that took the checkout, then run this again. Nothing was written.`
    );
  }
}

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/**
 * Throws when the project is not in git, or when any of `paths` has changes git does not hold.
 *
 * Unlike the plain migration, this one refuses a project outside git rather than going on, because
 * it moves the files with `git mv`.
 */
function requireCommitted(root, paths) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(
      `${root} is not inside a git repository. This command moves the project's files with ` +
        `'git mv' so that git keeps their history, so it needs one. Nothing was written.`
    );
  }
  const status = git(root, ['status', '--porcelain', '--', ...paths]);
  if (status.status !== 0) {
    throw new Error(`git could not report the status of the store's files. Nothing was written.\n${status.stderr}`);
  }
  const changed = status.stdout.trimEnd();
  if (changed !== '') {
    throw new Error(
      `Files this command would move or rewrite have uncommitted changes, and git is the only ` +
        `backup a store has. Commit or stash them, then run this again. Nothing was written:\n${changed}`
    );
  }
  // `git status` prints nothing for a file that git ignores, but `git mv` refuses to move such a
  // file. Without this check, the refusal would come after the earlier moves had run (`R-000624`).
  const untracked = paths.filter((file) => git(root, ['ls-files', '--error-unmatch', '--', file]).status !== 0);
  if (untracked.length > 0) {
    throw new Error(
      `Files this command would move are not tracked by git, for example because git ignores them, ` +
        `so 'git mv' cannot move them. Commit or remove them, then run this again. Nothing was ` +
        `written:\n  - ${untracked.join('\n  - ')}`
    );
  }
}

/** Returns the text of the rewritten registry, after proving that it loads and differs only in chain. */
function rewriteRegistry(records, registryPath) {
  const breaks = chainBreaks(records, FORMER_CHAIN_SEED);
  if (breaks.length > 0) {
    const first = breaks[0];
    throw new Error(
      `The chain of ${registryPath} does not verify against jtrack's seed at row ${first.position} ` +
        `(${first.id} rev ${first.rev}), so that row was changed after it was written. ` +
        `Recomputing the chain would hide the change, so nothing was written. Find out what ` +
        `happened to that row before migrating.`
    );
  }

  const text = rebuild(records);
  let after;
  try {
    after = validateRebuilt(text, { schemaPath: SCHEMA_PATH, count: records.length });
  } catch (error) {
    throw new Error(
      `The rewritten registry would not load, so nothing was moved or written: ${error.message}`,
      { cause: error }
    );
  }
  const problems = unexpectedChanges(records, after, ['chain']);
  if (problems.length > 0) {
    throw new Error(
      `The rewritten registry differs from what was read in ${problems.length} place(s) beyond ` +
        `the chain. Nothing was written:\n  - ${problems.join('\n  - ')}`
    );
  }
  return text;
}

export function run(argv) {
  const extra = argv.filter((arg) => arg !== '--from-jtrack');
  if (extra.length > 0) {
    throw new UsageError(`--from-jtrack takes no other option, and was given ${extra.join(' ')}.`);
  }

  const cwd = process.cwd();
  const root = findProject(cwd);
  if (root === null) {
    throw new Error(
      `No store found in ${cwd} or any parent directory, under either the jtrack names or the ` +
        `jtrek names, so there is nothing to migrate.`
    );
  }

  const { moves, storeDir, finalDir, configRewrite } = planMoves(root);
  const registryPath = path.join(storeDir, REGISTRY_FILENAME);
  const registry = readFormerRegistry(registryPath);

  if (moves.length === 0 && registry.current && configRewrite === null) {
    logger.info(
      `${root} already uses the jtrek names, and its registry states ${VERSION_KEY}. Nothing to ` +
        `migrate, and nothing was written.`
    );
    return 0;
  }

  requireNoOpenCheckout(storeDir);
  const touched = [...moves.map((move) => move.current), registryPath];
  if (configRewrite !== null) touched.push(configRewrite.current);
  requireCommitted(root, [...new Set(touched)]);
  const rewritten = registry.current ? null : rewriteRegistry(registry.records, registryPath);

  for (const move of moves) {
    const result = git(root, ['mv', move.from, move.to]);
    if (result.status !== 0) {
      throw new Error(
        `'git mv ${move.from} ${move.to}' failed, after the moves before it had run. Run ` +
          `'git status' to see what moved, and 'git reset --hard' to undo it:\n${result.stderr}`
      );
    }
    logger.info(`Moved ${path.relative(root, move.from)} to ${path.relative(root, move.to)}.`);
  }
  if (configRewrite !== null) {
    fs.writeFileSync(configRewrite.path, `${JSON.stringify(configRewrite.content, null, 2)}\n`);
    logger.info(`Wrote ${path.relative(root, configRewrite.path)}: its store key now names ${NEW_STORE_DIR}.`);
  }
  if (rewritten !== null) {
    const finalRegistry = path.join(finalDir, REGISTRY_FILENAME);
    fs.writeFileSync(finalRegistry, rewritten);
    logger.info(
      `Wrote ${path.relative(root, finalRegistry)}: its header now states ${VERSION_KEY} at format ` +
        `version ${SCHEMA_VERSION}, and all ${registry.records.length} row(s) are chained from ` +
        `jtrek's seed. No other field changed.`
    );
  }

  // The history group compares the registry against the copy that `HEAD` holds at the same path.
  // When the store directory moved, `HEAD` holds no copy at the new path, so the group cannot
  // compare and reports NOT CHECKED. When it did not move, every line differs, so the group fails.
  // Either way it passes once the migration is committed, and the message names the result the
  // owner is about to see. When the registry was not rewritten, the group compares an unchanged
  // file and passes, so the message says nothing about it (`R-000614`).
  let history = '';
  if (rewritten !== null) {
    const storeMoved = moves.some((move) => move.current === storeDir);
    const result = storeMoved
      ? `reports the history group as NOT CHECKED, because the last commit holds no registry at ` +
        `${path.relative(root, path.join(finalDir, REGISTRY_FILENAME))}`
      : `reports the history group as FAILED, because every line of the registry was rewritten`;
    history =
      ` Until the migration is committed, 'jtrek check' ${result}. The history check does not ` +
      `pass until then, and that is the gate working rather than a fault.`;
  }
  logger.info(
    `Nothing has been committed.${history} Run 'jtrek agent install' next, so that the generated ` +
      `instructions use the jtrek names, then run 'jtrek build' and commit the result.`
  );
  return 0;
}
