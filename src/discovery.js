/**
 * src/discovery.js finds the store from whatever directory the tool was run in.
 *
 * The original scripts, which lived inside the repository they served, located the store as
 * `path.resolve(__dirname, '..')`. In other words, they assumed that the store was their own parent
 * directory. That assumption holds only while the scripts live inside the store they operate on. A
 * globally installed tool has no such relationship to any store, so discovery walks up from the
 * working directory, in the same way that `git` finds `.git`.
 *
 * A store is located in one of four ways, tried in this order:
 *
 *   1. `JTREK_STORE` gives an explicit path, and no walking happens. `WORK_TRACKING_STORE` is
 *      accepted as another name for it, so that the original test harness and any existing shell
 *      aliases keep working.
 *   2. A `store` key in a `jtrek.json` file in an ancestor directory names the store directory,
 *      relative to that file. A `jtrek.json` without that key exists for some other purpose, and
 *      it is not treated as saying where the store is.
 *   3. A directory named `jtrek/` in an ancestor directory is found by checking for it.
 *   4. If none of these finds a store, the result is an error that suggests `jtrek init`.
 *
 * The tool was called jtrack before it was renamed to jtrek, and every name above then said
 * `jtrack`. A project that still uses those names is refused rather than read. The refusal comes
 * when `JTRACK_STORE` is set without `JTREK_STORE`, or when an ancestor holds `jtrack.json` or a
 * `jtrack/` store and no store under the new names was found at that level or a nearer one.
 *
 * Step 3 is necessary rather than merely convenient. A tool that could only find a store it had
 * configured itself would need a configuration file committed into every project before it could
 * read anything. Checking for `jtrek/` is what lets a fresh clone work with no setup at all.
 *
 * Only one directory name is checked for, although there used to be two more. `.jtrack/` was a
 * hidden default, and `work_tracking/` was checked so that the store jtrek was extracted from
 * would be found without being changed. Both were dropped in favour of a single visible name, as
 * `R-0017` decided. The cost is that a store called `work_tracking/` is no longer found by walking
 * up. The store jtrek came from therefore now needs either a `jtrek.json` that names it or a
 * rename.
 *
 * At each ancestor, both the configuration file and the `jtrek/` directory are checked before
 * moving up to the next ancestor. The alternative would be to scan every ancestor for a
 * configuration file first and then every ancestor for a store. Checking both at each level means
 * that a nearer store takes precedence over a more distant configuration file, which is what
 * someone working inside a nested project expects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';

const logger = createLogger('jtrek/discovery');

/**
 * The configuration file that can name the store. It is read from an ancestor directory, and it is
 * never required to exist.
 */
export const CONFIG_FILENAME = 'jtrek.json';

/**
 * The directory names checked for when no configuration file names the store. They are checked in
 * each ancestor, starting with the nearest.
 *
 * There is deliberately only one name. `jtrek/` is what `jtrek init` creates, and it is the only
 * name discovery checks for, so the question of where the store is has one answer that a person
 * can remember. A store under any other name can still be used, but only by naming it in
 * `jtrek.json` or in `JTREK_STORE`.
 *
 * The name is visible rather than hidden, because people are meant to read what the directory
 * holds. `registry.md` is generated and then committed so that it can be read in review, and
 * `jtrek_plan.md` explains what the work is for. Neither belongs in a hidden directory.
 */
export const STORE_DIR_CANDIDATES = ['jtrek'];

/**
 * The file whose presence makes a directory a store. It is the append-only log, and everything else
 * in the store is derived from it.
 */
export const REGISTRY_FILENAME = 'registry.ndjson';

/**
 * The path of the schema, which ships with the tool rather than with the store.
 *
 * The schema is code, because it is the validator that every command runs. It is therefore
 * versioned with the package and never read from the store directory. The original scripts made
 * the same split at line 33 of `lib.js`. They located the schema beside the scripts even when
 * `WORK_TRACKING_STORE` had moved everything else.
 */
export const SCHEMA_PATH = path.resolve(import.meta.dirname, '..', 'schema.sql');

/**
 * Returns every path a command needs, derived once from the store directory.
 *
 * Paths are resolved against two different base directories, and confusing the two produces
 * failures that are not real. A record's `detail_ref` is resolved against the store directory.
 * Entries such as `../docs/…` are ordinary there, and the store directory is also where
 * `registry.md` links from. An entry of the `markdown` key in `jtrek.json` is resolved against the
 * project root, because such an entry names a document anywhere in the repository. The README of
 * the reference implementation records that this mistake has already been made once, with
 * `detail_ref`.
 *
 * The project root is the directory that holds `jtrek.json` when there is one, and otherwise the
 * store's parent directory.
 *
 * `projectRoot` can also be passed in directly, and only `init` does so. In
 * `jtrek init --store work/store`, the store path is relative to the working directory, and the
 * parent of that store is `work/` rather than the project. The caller knows which directory the
 * user was working in, so it passes that directory as the project root.
 */
export function storeAt(dir, { source, configPath = null, config = {}, projectRoot = null }) {
  return {
    dir,
    source,
    configPath,
    config,
    projectRoot: projectRoot ?? (configPath ? path.dirname(configPath) : path.dirname(dir)),
    registryPath: path.join(dir, REGISTRY_FILENAME),
    registryMdPath: path.join(dir, 'registry.md'),
    registryDbPath: path.join(dir, 'registry.db'),
    recordsDir: path.join(dir, 'records'),
    workPath: path.join(dir, 'work.json'),
    schemaPath: SCHEMA_PATH,
  };
}

/**
 * Checks whether a row's `detail_ref` breaks the rule that a prose file inside `records/` is named
 * after the record that owns it. Under that rule, which `R-000139` introduced, `R-0116` owns
 * `records/R-0116.md`.
 *
 * The function returns null when the rule holds or does not apply. Otherwise it returns the path
 * that the row should name. The path is resolved against the store directory, as every
 * `detail_ref` is, so `records/x.md` and `./records/x.md` count as the same file. A path outside
 * `records/` is not judged at all, because a `detail_ref` may legitimately point elsewhere, such as
 * into `../docs/`.
 *
 * The function only compares names and reads no file. It is therefore cheap enough for both
 * `jtrek checkin` and `jtrek check` to run.
 */
export function misnamedProse({ id, detail_ref: detailRef }, storeDir) {
  if (!detailRef) return null;
  const recordsDir = path.join(storeDir, 'records');
  const relative = path.relative(recordsDir, path.resolve(storeDir, detailRef));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (path.basename(relative) === `${id}.md`) return null;
  return `records/${id}.md`;
}

/**
 * Returns every directory from `start` up to and including the filesystem root, nearest first.
 */
export function ancestors(start) {
  const chain = [];
  let dir = path.resolve(start);
  for (;;) {
    chain.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return chain;
    dir = parent;
  }
}

/**
 * Reads `jtrek.json`, or returns null if the file does not exist.
 *
 * A configuration file that exists but cannot be parsed is an error, not a missing file. If
 * discovery walked past it, it would fall back to checking for a `jtrek/` directory without any
 * warning. It could then operate on a different store from the one the file names. That failure
 * is worth an explicit error.
 */
export function readConfig(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    logger.error(`Cannot read the config at ${configPath}`);
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    logger.error(`${configPath} is not valid JSON.`);
    throw new Error(`${configPath} is not valid JSON: ${error.message}`, { cause: error });
  }
}

/**
 * Returns true when a directory holds a registry. This is the only test of whether a directory is
 * a store.
 */
export function isStore(dir) {
  return fs.existsSync(path.join(dir, REGISTRY_FILENAME));
}

/**
 * The names the tool used for these files while it was called jtrack, before it was renamed to
 * jtrek. Discovery does not read a store under these names. It refuses one instead, so that the
 * code holds one set of names, and so that a project which has not yet renamed its files is told
 * to rename them rather than being told that it has no store at all. A jtrack store's registry
 * also says `jtrack` in its header key and in the seed of its hash chain. Those two names are not
 * listed here, because they are inside the registry rather than in a file's name, and
 * `jtrek migrate --from-jtrack` rewrites them together with the file names.
 */
export const FORMER_CONFIG_FILENAME = 'jtrack.json';
export const FORMER_STORE_DIR = 'jtrack';
export const FORMER_STORE_VARIABLE = 'JTRACK_STORE';

/**
 * Returns the paths in one directory that still carry the former names: a `jtrack.json`, and a
 * `jtrack/` directory holding a registry. The list is empty when there are none.
 */
export function formerNamesIn(dir) {
  const found = [];
  const configPath = path.join(dir, FORMER_CONFIG_FILENAME);
  if (fs.existsSync(configPath)) found.push(configPath);
  const storeDir = path.join(dir, FORMER_STORE_DIR);
  if (isStore(storeDir)) found.push(path.join(storeDir, REGISTRY_FILENAME));
  return found;
}

/**
 * Locates the store.
 *
 * `mustExist: false` is for `init`. It needs to know whether a store exists, and it must not be
 * refused merely because no store exists, since creating one is its purpose. It is still refused
 * when the search meets the former names, because `init` would otherwise create a second store
 * beside the one the project already has.
 */
export function findStore({ cwd = process.cwd(), env = process.env, mustExist = true } = {}) {
  // A shell that still exports the former variable means to name a store. Ignoring the variable
  // would silently send every command to whatever store the search found instead.
  if (env[FORMER_STORE_VARIABLE] && !env.JTREK_STORE) {
    throw new Error(
      `${FORMER_STORE_VARIABLE} is set, but jtrek no longer reads it, because the tool was renamed ` +
        `from jtrack to jtrek. Rename the variable to JTREK_STORE.`
    );
  }

  const override = env.JTREK_STORE ?? env.WORK_TRACKING_STORE;
  if (override) {
    const dir = path.resolve(override);
    const source = env.JTREK_STORE ? 'JTREK_STORE' : 'WORK_TRACKING_STORE';
    // An explicit path is used even when the directory is empty. That is how the test harness
    // points at a temporary directory that its first command is expected to fill.
    return storeAt(dir, { source });
  }

  for (const dir of ancestors(cwd)) {
    const configPath = path.join(dir, CONFIG_FILENAME);
    const config = readConfig(configPath);

    // Only a `store` key decides where the store is. A configuration file may exist to set
    // something else entirely, and the `instructions` key already does so. Earlier, the mere
    // presence of the file was taken to mean that it named the store. Every command was then
    // pointed at a default directory that did not exist, and the real store, found by the check
    // just below, was ignored without any warning. The configuration is still passed along with
    // whatever store that check finds at the same level, so its other keys keep working.
    if (config?.store !== undefined) {
      return storeAt(path.resolve(dir, config.store), { source: configPath, configPath, config });
    }

    for (const candidate of STORE_DIR_CANDIDATES) {
      const storeDir = path.join(dir, candidate);
      if (isStore(storeDir)) {
        return storeAt(storeDir, {
          source: `${candidate}/${REGISTRY_FILENAME}`,
          configPath: config ? configPath : null,
          config: config ?? {},
        });
      }
    }

    // This runs only after both of the current names have been checked at this level, so a
    // project that holds the new names beside a leftover jtrack.json is used rather than refused.
    const former = formerNamesIn(dir);
    if (former.length > 0) {
      throw new Error(
        `Found ${former.join(' and ')}, which carry the names the tool used while it was called ` +
          `jtrack. jtrek reads only ${CONFIG_FILENAME} and ` +
          `${STORE_DIR_CANDIDATES.map((name) => `${name}/`).join(' or ')}, so rename these to ` +
          `their jtrek names before running jtrek again. 'jtrek migrate --from-jtrack' renames ` +
          `them and rewrites the registry to match.`
      );
    }
  }

  if (!mustExist) return null;

  throw new Error(
    `No jtrek store found in ${cwd} or any parent directory. Looked for ${CONFIG_FILENAME}, ` +
      `then for ${STORE_DIR_CANDIDATES.map((name) => `${name}/${REGISTRY_FILENAME}`).join(' or ')}. ` +
      `Run 'jtrek init' to create one, or set JTREK_STORE to an existing store.`
  );
}
