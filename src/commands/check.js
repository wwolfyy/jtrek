/**
 * src/commands/check.js implements `jtrek check`, which verifies the store against the rules that
 * its own files cannot enforce.
 *
 * Every other enforcement in jtrek asks who is about to write. This command asks what the file
 * looks like now. `jtrek guard` matches a list of editing tools, and it finds the store from the
 * directory in which the agent was launched. Its coverage therefore depends on configuration that
 * it cannot observe, and `R-0039` measured that coverage as ranging from most writes to none. A
 * check that reads the result needs nothing from the tool that produced it. An edit made through
 * `Edit`, Bash, `sed`, an editor or a different agent therefore arrives here in the same form.
 *
 * Eight groups of checks run, and the output names each one. A sound store and a store with one
 * property verified produce the same exit code. A reader who cannot tell the two apart will
 * believe the wrong one, so the output has to say which checks ran. The groups are these:
 *
 *   - `history` checks that `registry.ndjson` was appended to and never altered (`R-0037`).
 *   - `chain` checks that every row carries the hash that its contents and its place in the file
 *     produce, so that no row was fabricated, moved or edited (`R-0036`).
 *   - `references` checks that every `detail_ref` names a file that exists, and that every
 *     `supersedes`, `split_from` and `related` names a record that exists. It checks that every
 *     `related` group uses a kind the vocabulary holds (`R-000151`), that no prose file is left
 *     unreferenced (`R-0010`), that no prose file is named by two records (`R-000135`), and that
 *     each prose file in `records/` is named for its record (`R-000139`). It also checks that a
 *     postponement's `until` names a record that exists (`R-0086`).
 *   - `registry-md` checks that the committed `registry.md` equals a fresh render (`R-0010`).
 *   - `markdown` checks that the store's own prose, and any document named by the `markdown` key of
 *     `jtrek.json`, carries none of the structural signatures that a rewriting editor leaves
 *     (`R-0119`, `R-000125`).
 *   - `plan` checks that every current record's `plan` value names a section of the plan document,
 *     and that no two sections share a slug (`R-0016`). It makes the comparison `jtrek plan check`
 *     makes, by calling the same function.
 *   - `spec` checks that every requirement's `feature` value names a heading of the spec document,
 *     that no two headings share a slug, and that the requirements rendered in the document equal
 *     the store (`R-000201`). The last of these is the comparison `jtrek build --check` makes for
 *     the spec, by calling the same function.
 *   - `tests` checks that every requirement in force names, in `files`, a file that exists and
 *     contains the requirement's id, which is the link to the test that verifies it (`R-000371`).
 *     It does not run the tests. `src/test-links.js` says why.
 *
 * The `markdown` group is the only one that reads documents rather than rows. The `plan` and `spec`
 * groups read a document together with the rows, and the `tests` group reads the files the rows
 * name. The other four read `registry.ndjson` or
 * something generated from it, and they exist because the store's own files cannot enforce their
 * rules. The `markdown` group exists because `R-0092` records an editor
 * rewriting markdown files without being asked, with no setting that turns the behaviour off. The
 * group sits in this command not because the subject fits, but because this is a command that a
 * session already runs. `rules/closing-a-session.md` names the four gates as commands to run at
 * every close, and it leaves tests to each project to add. A check built anywhere else would fire
 * only when somebody remembered to run it. `src/markdown.js` holds the signatures themselves and
 * the evidence behind each one.
 *
 * ## The append-only check
 *
 * A legitimate change to `registry.ndjson` only ever adds lines at the end of the file. Under git,
 * that change has a shape in a diff that no other kind of write produces. The diff therefore
 * exposes every other kind of write, without any schema change and without any new state to keep
 * in step. The shapes are these:
 *
 *   - A pure append reads `@@ -27,0 +28,20 @@`. No old line is touched, and the insertion point is
 *     the old last line.
 *   - Editing an earlier row in place reads `@@ -4 +4 @@`, which consumes one old line.
 *   - Inserting in the middle reads `@@ -1,0 +2 @@`. No old line is touched, but the insertion
 *     point is not the end.
 *   - Deleting reads `@@ -2 +1,0 @@`, which consumes one old line.
 *
 * The rule is therefore that any hunk consuming an old line is a violation, and any insertion
 * whose point is not the old end of the file is a violation. `R-0038` measured what this recovers.
 * On a store of 49 rows, `jtrek build --check` missed 5 of 9 tampered fields on current revisions,
 * and every tampered field on superseded revisions. Roughly a quarter of the store could be
 * rewritten without any gate noticing.
 *
 * This check cannot tell a genuine append by check-in from a line typed by hand at the end of the
 * file. The `chain` group below answers that. The two groups complement each other. This one
 * catches alteration, deletion, insertion and reordering of rows that are already committed, and it
 * needs no schema change. The chain also catches a fabricated append, and it needs a column.
 *
 * ## The chain check
 *
 * Every row carries the sha256 of the previous row's chain value followed by its own fields. The
 * file's order and its content are therefore tied together. A row appended at the end of the file
 * by something that computed no hash carries no value at all, so it fails the schema outright. A
 * row that is edited, moved or removed makes the value of some later row wrong, and this group is
 * what compares the values.
 *
 * After a mismatch, verification continues from the value stored on the mismatched row. If it
 * carried the computed value forward instead, it would report every row after the first fault as
 * broken, and a report naming three hundred rows says nothing about which row was touched.
 * `store.js:chainBreaks` holds that reasoning, and the argument that continuing this way stays
 * sound.
 *
 * The chain overlaps `history` and does not replace it. The chain is checked against nothing but
 * the file in front of it. A store rewritten whole, with every row rechained after the edit,
 * therefore passes this group. It fails `history`, which compares the file against what git holds.
 * Each group covers what the other cannot.
 *
 * `--since` exists because the default comparison stops seeing an edit once the edit is committed.
 * Comparing the working tree against `HEAD` catches an edit while it is still uncommitted, which is
 * the state a session leaves it in. Once the tampered row is committed, `HEAD` contains it and the
 * diff is clean. A whole branch is covered by passing the merge base of the branch and its
 * upstream. The closing procedure does that in its last step, because jtrek's gates run there
 * rather than in CI (`R-0084`).
 *
 * One shape reports as a violation without being a hand edit. When the registry's last line has no
 * terminating newline, `jtrek checkin` adds one before appending (`appendToRegistry` in
 * `checkin.js`). That consumes the old last line, so it reads here as a modification. A registry in
 * that state was already written by something other than the loop, so the report says what it saw
 * rather than excusing it.
 *
 * ## The reference checks
 *
 * These checks read the store rather than git. Every one of them that reads rows reads every row,
 * rather than only the current revision of each record, and that is deliberate in each case. A
 * prose file is shared by all of a record's revisions and is never rewritten, so a superseded
 * revision points at the same path, and its claim is just as broken if the file is gone. A link
 * written at rev 1 is still carried at rev 4. A file referenced only by a superseded revision is
 * referenced, not orphaned. And a file named by an earlier revision still belongs to that record.
 *
 * One check in this group reads `jtrek.json` instead of a row. A postponement's `until` names the
 * record whose closure ends the postponement, so it points at a record. Asking whether that record
 * exists is the same question that is asked of `supersedes`. `inspectUntil` answers it, and
 * `R-0086` says why it was added.
 *
 * `detail_ref` is resolved against the store directory, and not against the project root. Entries
 * such as `../docs/…` are ordinary, and `registry.md` links to prose files from inside the store.
 * `discovery.js:storeAt` records resolving against the wrong base as a mistake that has already
 * been made once. Doing so reports every such entry as missing.
 *
 * Two records sharing one prose file is reported, and that reverses an earlier ruling. Until
 * `R-000135` the sharing was tolerated, for the following reason. When `R-0060` superseded `R-0071`
 * as a duplicate, it took over that record's prose file rather than moving it. Prose is appended to
 * and never rewritten, so once an earlier revision points at a path, the path cannot change. The
 * owner overruled that on 2026-09-21. A prose file belongs to one record, and a second record
 * naming it is a defect to fix rather than an arrangement to accommodate. The file opens by stating
 * one record's problem, so a reader arriving from the other record lands on a subject that is not
 * theirs.
 *
 * The records that prompted the tolerance also showed its cost. `R-000134` gave `R-0060` a file of
 * its own that points to `R-0071.md` instead of naming it in `detail_ref`. That is the shape the
 * refusal now recommends, because a pointer is not a duplicate, and each file goes on belonging to
 * one record. `R-000131`'s migration had nearly written a broken path, because it assumed the
 * opposite.
 *
 * ## Postponing a check
 *
 * A `check` block in `jtrek.json` names the checks whose failure must not fail the run:
 *
 * ```json
 * { "store": "jtrek", "check": { "postpone": ["history"], "why": "…", "until": "R-0085" } }
 * ```
 *
 * Postponement is set for each check separately, and that is not generality for its own sake. The
 * postponement in this repository existed because rewriting jtrek's own history is sometimes the
 * work (`R-0085`). That reason applies to `history` and to nothing else. A `detail_ref` naming a
 * file that does not exist is a defect in every circumstance. A single switch for all checks would
 * let a narrow, argued allowance silently disable four unrelated checks.
 *
 * `why` and `until` are required, and an unknown check name is refused. A gate turned off with no
 * stated reason and no condition that would turn it back on stays off permanently, and nobody finds
 * out by reading the configuration. The store's own `deferred` status carries the same requirement:
 * parking work is allowed, but parking it without naming what would restart it is not.
 *
 * Those refusals ask only whether `until` was written, and whether it is a non-empty string.
 * Whether the record it names exists is asked by the `references` group instead, for two reasons.
 * First, answering it means reading every row of the registry, and `enforcement` runs before the
 * store is opened. Second, an `until` naming a record that does not exist is the same kind of fault
 * as a `detail_ref` naming a file that does not exist. It is therefore reported, and postponed, on
 * the same terms as the rest of that group.
 *
 * A postponed check is not a quiet one. Its findings still print in full, and the postponement is
 * stated on every run, including a clean run. The second half is the point. `R-0038` measured the
 * damage done by `build --check` returning 0 on a tampered store. The damage was never that it
 * failed to block something. It was that a passing run meant less than its reader believed. A
 * softened gate that says nothing on a clean run would recreate exactly that.
 *
 * Usage:
 *   jtrek check                        working tree against HEAD
 *   jtrek check --since <ref>          working tree against <ref>, such as a branch's merge base
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { misnamedProse } from '../discovery.js';
import { RELATION_KINDS, chainBreaks, compareIds, currentRecords, openStore } from '../store.js';
import { render } from './build.js';
import { inspectDocument, SIGNATURE_NAMES } from '../markdown.js';
import { PLAN_FILENAME, inspectPlan, planFindings } from '../plan.js';
import { SPEC_FILENAME, inspectSpec, specFindings } from '../spec.js';
import { inspectTestLinks, testLinkFindings } from '../test-links.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/check');

export const USAGE = 'Usage: jtrek check [--since <ref>]';

export function parseArgs(argv) {
  const args = { since: 'HEAD', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--since') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`'--since' needs a git ref. ${USAGE}`);
      }
      args.since = value;
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

/**
 * This is how much output a git call here may produce before `spawnSync` gives up.
 *
 * The default limit is 1 MB, and a real store exceeds it. A whole-file rewrite makes `git diff`
 * print every line twice, once as removed and once as added. A registry of 372 rows carrying long
 * notes produced roughly 1.5 MB that way, and the call failed with `ENOBUFS`. That failure is
 * reported as "cannot verify", so the run reported `history` as NOT CHECKED and exited 0. That is
 * the shape `R-0038` names as the real damage: a passing run that means less than its reader
 * believes. The migration that rewrites a store is exactly when the check matters most, and it is
 * exactly when the output overflowed.
 *
 * Only the hunk headers are used, so almost all of this output is read and then discarded.
 * Streaming the headers instead would require the call to stop being synchronous, and every caller
 * here depends on it being synchronous. A ceiling far above any registry anyone will write is the
 * cheaper answer.
 */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/**
 * This runs git, and reports a failure as a returned value rather than by throwing.
 *
 * Every caller here has a legitimate case in which git exits non-zero: the directory is not a
 * repository, a ref does not exist, or a path is absent from that ref. Each of those means that the
 * store cannot be verified, rather than that the store is broken. Telling those cases apart from a
 * real violation is the whole point of the command, so they must not arrive as the same exception.
 */
export function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
  if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').trim(),
  };
}

/**
 * This counts lines the way a diff hunk header does.
 *
 * It does not count the way `wc -l` does, which counts newline characters. A file of three lines
 * whose last line has no newline is three lines to git and two to `wc`. The append test compares an
 * insertion point against this number, so the count has to be git's.
 */
export function countLines(text) {
  if (text === '') return 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * This reads `{ oldStart, oldCount, newStart, newCount }` from every hunk header in a unified diff.
 *
 * A count that is left out means one. For example, `@@ -2 +2 @@` is a single old line replaced by
 * a single new one. Reading an omitted count as zero would let every edit in place through, and
 * catching those edits is the main thing this check exists to do.
 */
export function parseHunks(diff) {
  const hunks = [];
  for (const line of diff.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  return hunks;
}

/**
 * This is true when the hunks describe one edit that consumed the entire file.
 *
 * A rewrite of the whole file arrives as a single hunk that starts at line 1 and consumes every
 * line the base held. Nothing else produces that shape. A hand edit touches some lines and leaves
 * others, so its hunks either start below line 1 or stop short of the end.
 */
function isWholeFile(hunks, baseLines) {
  return (
    baseLines > 0 &&
    hunks.length === 1 &&
    hunks[0].oldStart === 1 &&
    hunks[0].oldCount === baseLines
  );
}

/**
 * This judges a set of hunks against a base of `baseLines` lines.
 *
 * It is kept separate from the git calls for two reasons. The rule itself can then be tested
 * without a repository. And the four shapes in this module's header become four cases that a test
 * can state directly.
 *
 * One shape gets a different message, but the same verdict. A migration rebuilds the store, so
 * every line changes. The ordinary report names a line number and tells the reader to correct a row
 * by appending its next revision. That advice describes a hand edit, and it is useless to somebody
 * who has just run `jtrek migrate`. `R-000155` settled what to do about it. The check recognises
 * the shape of a whole-file rewrite and says so, and it names the range that verifies cleanly.
 *
 * The different message is not a permission, and that distinction is the whole decision. The
 * finding stands, the check still fails, and the exit code is unchanged. The alternative was to let
 * a migration declare itself legitimate by checking in a row that says it ran, and it was rejected.
 * A gate that claims "appended and never altered" is worth something only while nothing can place
 * itself outside the gate. A forged row saying a migration ran is no harder to write than any other
 * forged marker.
 */
export function violationsIn(hunks, baseLines) {
  const violations = [];
  const wholeFile = isWholeFile(hunks, baseLines);

  for (const hunk of hunks) {
    if (wholeFile) {
      violations.push({
        hunk,
        message:
          `all ${baseLines} line(s) were replaced — the whole file was rewritten, rather than ` +
          `some rows within it being edited. A migration does this: 'jtrek migrate' rebuilds ` +
          `the store to satisfy a new schema, and it is the only sanctioned write of that shape. ` +
          `If that is what happened, commit the rebuild — this comparison is clean again once it ` +
          `is in HEAD — and verify a range that spans it with 'jtrek check --since <the commit ` +
          `that rebuilt the store>'. If it is not what happened, the store was rewritten by ` +
          `something else and the committed copy is what to restore.`,
      });
      continue;
    }
    if (hunk.oldCount > 0) {
      violations.push({
        hunk,
        message:
          `${hunk.oldCount} line(s) at line ${hunk.oldStart} were changed or removed. ` +
          `Rows already written are never edited — correct one by appending its next revision.`,
      });
      continue;
    }
    if (hunk.oldStart !== baseLines) {
      violations.push({
        hunk,
        message:
          `${hunk.newCount} line(s) were inserted after line ${hunk.oldStart} of ${baseLines}, ` +
          `not at the end. Rows are only ever appended.`,
      });
    }
  }
  return violations;
}

/**
 * This compares the registry against the git ref `since`.
 *
 * The result is returned rather than printed, so that another command can report the same finding
 * without running this one as a separate process.
 *
 * A result with `verifiable: false` carries a `reason`, and it is never a violation. A store
 * outside git, or a store whose registry that ref has never held, cannot be checked this way at
 * all. Failing on it would leave the gate failing permanently wherever git is not how the store is
 * shared. `R-0019` recorded that outcome for the size policy.
 */
export function inspectHistory({ registryPath, since = 'HEAD' } = {}) {
  const dir = path.dirname(registryPath);

  const toplevel = git(['rev-parse', '--show-toplevel'], dir);
  if (!toplevel.ok) {
    return { verifiable: false, reason: `${dir} is not inside a git repository.`, violations: [] };
  }

  const relative = git(['ls-files', '--full-name', '--', path.basename(registryPath)], dir);
  const tracked = relative.ok ? relative.stdout.trim() : '';
  if (tracked === '') {
    return {
      verifiable: false,
      reason: `${registryPath} is not tracked by git, so there is no committed history to compare.`,
      violations: [],
    };
  }

  const base = git(['show', `${since}:${tracked}`], dir);
  if (!base.ok) {
    return {
      verifiable: false,
      reason: `'${since}' does not hold ${tracked}, so there is nothing to compare against.`,
      violations: [],
    };
  }

  const diff = git(['diff', '--unified=0', since, '--', registryPath], dir);
  if (!diff.ok) {
    return {
      verifiable: false,
      reason: `git could not diff ${tracked} against '${since}': ${diff.stderr}`,
      violations: [],
    };
  }

  const baseLines = countLines(base.stdout);
  const hunks = parseHunks(diff.stdout);
  const added = hunks.reduce((total, hunk) => total + hunk.newCount, 0);

  return {
    verifiable: true,
    since,
    tracked,
    baseLines,
    added,
    // This is returned so that the caller can leave out the R1 remedy that it prints under a
    // failure. That remedy tells the reader to restore the file and make the change through the
    // loop. It is the right advice for a hand edit and the wrong advice for a migration, and a
    // whole-file rewrite is the one finding that may be either.
    wholeFile: isWholeFile(hunks, baseLines),
    violations: violationsIn(hunks, baseLines),
  };
}

/**
 * This resolves every reference the store makes to something outside its own row.
 *
 * `rows` holds every revision, and not only the current revision of each record. The module header
 * explains why each of these checks reads the whole log, rather than only each record's current
 * row.
 *
 * The findings are returned rather than printed, so that `run` decides what a finding costs. A
 * later caller can also ask the same questions without running this command as a separate process.
 *
 * `pending` maps the absolute path of a prose file to the id of a record in the open checkout that
 * names it, as `openCheckoutProse` reads it. Such a file is not an orphan (R-000548). A new
 * record's prose file has to be written before its check-in, as R2 requires, but its row exists
 * only once the check-in writes it. Without this exception, the gates could not pass before any
 * check-in that writes a new record. The file is returned under `accepted` rather than dropped, so
 * that the caller can say why it passed (R-000549).
 */
export function inspectReferences({ rows, storeDir, recordsDir, until = null, pending = new Map() }) {
  const ids = new Set(rows.map((row) => row.id));
  const unresolved = [];
  const dangling = [];
  const badKinds = [];
  const referenced = new Set();

  for (const row of rows) {
    if (row.detail_ref) {
      // The path is resolved against the store directory. The module header explains why.
      const resolved = path.resolve(storeDir, row.detail_ref);
      referenced.add(resolved);
      if (!fs.existsSync(resolved)) {
        unresolved.push({ id: row.id, rev: row.rev, ref: row.detail_ref });
      }
    }

    const links = row.split_from ? [['split_from', row.split_from]] : [];
    for (const target of row.supersedes ?? []) links.push(['supersedes', target]);
    // The ids in `related` are resolved here and nowhere else, which is the opposite of the other
    // two links. `jtrek checkin` refuses a new `split_from` or `supersedes` that names a record
    // outside the checkout, so those links are partly caught when they are written. `related` is
    // exempt from that rule by design (R-000138), so this group is the only thing that ever
    // resolves one of its ids.
    //
    // The field groups its ids by kind, so the finding names the kind. A field name such as
    // "related.depends_on" tells the reader which group to correct without opening the row.
    for (const [kind, targets] of Object.entries(row.related ?? {})) {
      if (!RELATION_KINDS.includes(kind)) badKinds.push({ id: row.id, rev: row.rev, kind });
      for (const target of targets ?? []) links.push([`related.${kind}`, target]);
    }
    for (const [field, target] of links) {
      if (!ids.has(target)) dangling.push({ id: row.id, rev: row.rev, field, target });
    }
  }

  // Only `records/` is searched for unreferenced files. A `detail_ref` may legitimately point
  // outside it, for example to `../docs/…`, and those targets were verified above. What cannot be
  // verified from the other direction is whether some unrelated file elsewhere in the repository
  // was meant to be a record's prose. Searching the whole project for markdown is exactly the crawl
  // that this command was designed to avoid.
  const orphans = [];
  const accepted = [];
  if (fs.existsSync(recordsDir)) {
    // The files are sorted by the number in the id, where the filename carries one, so the list
    // reads in record order whatever the width of the ids. Files that are not named for a record
    // keep the order of their names and sort after the ones that are. That is where an orphaned
    // file is easiest to notice.
    const named = fs.readdirSync(recordsDir).sort((a, b) => {
      const [x, y] = [a, b].map((name) => (/^R-\d{4,}\.md$/.test(name) ? Number(name.slice(2, -3)) : null));
      if (x !== null && y !== null) return x - y;
      if (x !== null) return -1;
      if (y !== null) return 1;
      return a.localeCompare(b);
    });
    for (const name of named) {
      if (!name.endsWith('.md')) continue;
      const resolved = path.resolve(recordsDir, name);
      if (referenced.has(resolved)) continue;
      if (pending.has(resolved)) accepted.push({ file: path.join('records', name), id: pending.get(resolved) });
      else orphans.push(path.join('records', name));
    }
  }

  // A prose file belongs to one record (R-000135). Ownership is read from every row, rather than
  // only from current rows, because a file named by a superseded revision still belongs to that
  // record. That revision goes on pointing at it. `jtrek checkin` refuses a shared file when a row
  // is written. This group catches a row that reached the registry another way, which is what a
  // migration can produce.
  const owners = new Map();
  for (const row of rows) {
    if (!row.detail_ref) continue;
    if (!owners.has(row.detail_ref)) owners.set(row.detail_ref, new Set());
    owners.get(row.detail_ref).add(row.id);
  }
  const sharedProse = [...owners]
    .filter(([, holders]) => holders.size > 1)
    .map(([ref, holders]) => ({ ref, ids: [...holders].sort(compareIds) }));

  // A prose file inside records/ is named for the record that owns it (R-000139). This is read from
  // every row, as the checks above are, because a revision that named a wrong file goes on naming
  // it. `jtrek checkin` refuses a wrongly named file when a row is written. This group catches a
  // row that reached the registry another way.
  const misnamed = rows
    .map((row) => ({ id: row.id, rev: row.rev, ref: row.detail_ref, expected: misnamedProse(row, storeDir) }))
    .filter((item) => item.expected !== null);

  const danglingUntil = inspectUntil(until, ids);
  return {
    rows: rows.length,
    unresolved,
    dangling,
    orphans,
    accepted,
    sharedProse,
    misnamed,
    badKinds,
    danglingUntil,
  };
}

/**
 * Returns the prose files that the records of the open checkout name, as a map from each file's
 * absolute path to the id of the record that names it.
 *
 * A checkout is open when `work.json` exists and carries no `checked_in` stamp, which is the
 * definition `jtrek checkout` uses. A stamped file returns an empty map, because its records are
 * already in the registry, so a prose file that their rows do not name is an orphan again
 * (R-000548). A `work.json` that is not valid JSON is an error rather than an empty checkout,
 * because such a file may still hold work that exists nowhere else.
 */
export function openCheckoutProse(workPath, storeDir) {
  const pending = new Map();
  if (!fs.existsSync(workPath)) return pending;
  let checkout;
  try {
    checkout = JSON.parse(fs.readFileSync(workPath, 'utf8'));
  } catch (error) {
    logger.error(`${workPath} is not valid JSON, so the open checkout could not be read.`);
    throw new Error(`${workPath} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (checkout?.checked_in || !Array.isArray(checkout?.records)) return pending;
  for (const record of checkout.records) {
    if (typeof record?.detail_ref !== 'string' || record.detail_ref === '') continue;
    pending.set(path.resolve(storeDir, record.detail_ref), record.id);
  }
  return pending;
}

/**
 * This matches a record id as it is written everywhere in the store: `R-` followed by at least four
 * digits. The number of digits has no upper limit, because jtrek pads new ids to six digits while
 * this store's early records have four. A pattern fixed at four digits would match `R-1000` inside
 * `R-100000`.
 */
const RECORD_ID = /R-\d{4,}/g;

/**
 * This resolves the record or records that a postponement's `until` names.
 *
 * `enforcement` has already refused an `until` that is missing or blank, so what arrives here is a
 * non-empty string. That is not enough on its own. An id such as `R-0185`, naming a record nobody
 * ever wrote, satisfies that requirement completely. `jtrek check` would then print that id on
 * every run as the work that would restore the postponed check, and a reader would have no way to
 * tell that it names nothing.
 *
 * An `until` that names no record at all is reported in the same way as one that names an absent
 * record. The reason is that the likeliest typo, `R-085`, contains no well-formed id. A rule that
 * accepted any string without an id would read that typo as a condition written in prose and let it
 * through, which is the same defect in a different form. An id inside a sentence is still found, so
 * "R-0085 closes and the rewrites stop" passes.
 *
 * This function produces findings rather than throwing. `enforcement` throws because a
 * configuration it cannot read leaves the run unable to say which checks are enforced. Here the
 * configuration is readable, and it is the store that disagrees with it, which is the kind of
 * problem the `references` group reports.
 */
export function inspectUntil(until, ids) {
  if (until === null || until === undefined) return [];
  const named = [...new Set(until.match(RECORD_ID) ?? [])];
  if (named.length === 0) return [{ until, target: null }];
  return named.filter((target) => !ids.has(target)).map((target) => ({ until, target }));
}

/** These are the checks this command knows how to run, and so the names that `postpone` accepts. */
export const CHECKS = [
  'history',
  'chain',
  'references',
  'registry-md',
  'markdown',
  'plan',
  'spec',
  'tests',
];

/** This lists every `.md` file directly inside a directory, sorted and relative to the root. */
function markdownFilesIn(dir, projectRoot) {
  const entry = path.relative(projectRoot, dir);
  return fs
    .readdirSync(dir)
    .sort()
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(entry, name));
}

/**
 * This lists the store's own prose, which is checked without anything being configured.
 *
 * These are the only markdown documents in an adopting project that no other gate compares against
 * anything. `jtrek agent install` writes its documents into `<store>/docs/`, and
 * `jtrek agent --check` reads each one back and compares it with what the installer would write
 * now. An editor that rewrote one of those documents is therefore caught there. `jtrek build
 * --check` compares `registry.md` in the same way. What is left over is the prose that a project
 * writes for itself: the plan, the spec, the architecture document, the hand-off, the coding
 * standards, and the prose file behind every record.
 * `agent.js:instructionProblems` says why those documents are excluded from that comparison. They are
 * the project's own writing, so there is nothing to compare them with. That exclusion is what
 * leaves them to this check.
 *
 * A default path that is absent is skipped, whereas a configured path that is absent is refused.
 * The difference is who named the path. A path in `jtrek.json` was written down by the project, so
 * its absence is a mistake worth stopping on. The paths here are jtrek's own guess about a store
 * it has not seen, and a project that has not run `jtrek agent install` legitimately has no plan
 * document and no hand-off. `R-0019` recorded what a default that fails on a new project costs.
 */
export function storeProseTargets(store) {
  const files = [];
  const names = ['jtrek_plan.md', SPEC_FILENAME, 'jtrek_architecture.md', 'jtrek_handoff.md', 'coding-standards.md'];
  for (const name of names) {
    const full = path.join(store.dir, name);
    if (fs.existsSync(full)) files.push(path.relative(store.projectRoot, full));
  }
  if (fs.existsSync(store.recordsDir)) files.push(...markdownFilesIn(store.recordsDir, store.projectRoot));
  return files;
}

/**
 * This lists the documents a project adds to the default, named by a `markdown` array in
 * `jtrek.json`.
 *
 * These are the documents that jtrek cannot discover for itself, and the key exists for exactly
 * those. In this repository they are in `rules/` and `rules/shared/`, which hold jtrek's own
 * sources and sit entirely outside the store. Another project's equivalents sit wherever that
 * project put them. Each entry is resolved against the project root rather than the store, because
 * such a document can sit anywhere in the repository.
 *
 * An empty array is refused. It looks like an attempt to opt out, but it is not one. The store's
 * own prose is checked whatever this key says, so an empty array would quietly do nothing while
 * looking deliberate. `markdown: false` is the way to opt out.
 *
 * A directory entry means every `.md` file directly inside that directory. That is how `rules/` is
 * named without listing its documents, so nobody has to remember to update a list when another
 * document is written.
 */
export function configuredMarkdownTargets(config, projectRoot, configPath = 'jtrek.json') {
  const entries = config?.markdown;
  if (entries === undefined || entries === null) return [];

  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
    throw new Error(
      `${configPath}: 'markdown' must be an array of paths, e.g. ["rules/", "docs/design.md"], ` +
        `or false to check nothing at all.`
    );
  }
  if (entries.length === 0) {
    throw new Error(
      `${configPath}: 'markdown' is empty. The store's own prose is checked whatever this key ` +
        `says, so an empty list opts out of nothing. Name the documents to add, remove the key, ` +
        `or set it to false to check nothing at all.`
    );
  }

  const files = [];
  const missing = [];
  for (const entry of entries) {
    const full = path.resolve(projectRoot, entry);
    if (!fs.existsSync(full)) {
      missing.push(entry);
      continue;
    }
    if (fs.statSync(full).isDirectory()) files.push(...markdownFilesIn(full, projectRoot));
    else files.push(entry);
  }

  if (missing.length > 0) {
    throw new Error(
      `${configPath}: 'markdown' names ${missing.join(', ')}, which does not exist relative to ` +
        `${projectRoot}. A path that is not there is checked by nothing, so it is refused rather ` +
        `than skipped.`
    );
  }

  return files;
}

/**
 * This lists every document the `markdown` group reads, or returns `null` when the project has
 * opted out.
 *
 * The default is the store's own prose, and the key adds to that default rather than replacing it.
 * `R-000125` recorded the failure this fixes. The group used to check only documents named in the
 * configuration. `jtrek init` writes `jtrek.json` as `{ store }` and mentions no other key, so an
 * adopting project reported NOT CHECKED for as long as nobody acted. The protection `R-0119` built
 * therefore reached only one repository. A default that the project does not need to write down is
 * what makes the check reach a second project.
 *
 * Opting out is done with `markdown: false`, and the check then reports NOT CHECKED, never ok. A
 * project whose record prose already carries these signatures goes from a passing run to a failing
 * one on the upgrade that adds this default, so there has to be a way to stand the gate down.
 * `R-0038` established what this project treats as the damage done by a gate that returns 0
 * without verifying anything. The damage is not that it failed to block something, but that a
 * passing run meant less than its reader believed. The line printed therefore says that the check
 * did not run, and that the configuration switched it off.
 */
export function markdownTargets(store, configPath = 'jtrek.json') {
  if (store.config?.markdown === false) return null;
  return [
    ...storeProseTargets(store),
    ...configuredMarkdownTargets(store.config, store.projectRoot, configPath),
  ];
}

/** This returns every finding in the given documents, each carrying the file it was found in. */
export function inspectMarkdown(files, projectRoot) {
  return files.flatMap((file) => {
    const text = readText(path.resolve(projectRoot, file));
    return inspectDocument(text).map((finding) => ({ file, ...finding }));
  });
}

/**
 * This reads the `check` block from `jtrek.json`, and decides which failures do not fail the run.
 *
 * A block that is absent and a block that is present but incomplete are different things, and only
 * the second is a failure. No block at all means that the project never postponed anything, so
 * every check is enforced. That is the default, and it needs no configuration. A block that
 * postpones something without saying `why`, or without naming in `until` what would restore the
 * check, is refused outright. Otherwise it would look the same, on every future run, as a gate that
 * nobody had noticed was off.
 *
 * An unknown check name is refused rather than ignored. A typo would otherwise read as a
 * postponement that silently does nothing, which is the same failure in the opposite direction.
 */
export function enforcement(config, configPath = 'jtrek.json') {
  const empty = { postponed: new Set(), why: null, until: null };
  const block = config?.check;
  if (block === undefined || block === null) return empty;

  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new Error(`${configPath}: 'check' must be an object, e.g. {"postpone": ["history"], …}.`);
  }

  const names = block.postpone;
  if (names === undefined || names === null) return empty;
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
    throw new Error(
      `${configPath}: 'check.postpone' must be an array of check names. Known: ${CHECKS.join(', ')}.`
    );
  }
  if (names.length === 0) return empty;

  const unknown = names.filter((name) => !CHECKS.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `${configPath}: 'check.postpone' names unknown check(s): ${unknown.join(', ')}. ` +
        `Known: ${CHECKS.join(', ')}.`
    );
  }

  for (const field of ['why', 'until']) {
    if (typeof block[field] !== 'string' || block[field].trim() === '') {
      throw new Error(
        `${configPath}: 'check.postpone' is set, so '${field}' is required. A gate turned off ` +
          `with no reason and no condition that would turn it back on is off permanently. ` +
          `'why' says what the postponement is for; 'until' names the record that removes it.`
      );
    }
  }

  return { postponed: new Set(names), why: block.why, until: block.until };
}

/**
 * This builds the closing line printed on any run that has at least one postponed check.
 *
 * The line exists to stop a reader mistaking this run for a clean one. A postponement makes a
 * failing check exit 0, so the exit code alone no longer tells the two apart, and this line is the
 * only thing that does.
 *
 * The line says outright whether anything was excused, whichever the answer is. Until `R-0115` the
 * case in which a failure was excused read "It cost nothing here: references failed above". The
 * reading a reader reaches first is that nothing was excused on this run, which is the exact
 * opposite of the condition that printed it. The sentence was probably meant to say that postponing
 * cost no visibility, since the finding is still printed in full above. Neither reading was marked
 * as the intended one, so the line did not settle which it was.
 *
 * The wording that replaced it names the cost that was actually paid. On such a run a check
 * genuinely failed and the command still exits 0, and that is the one fact that separates the run
 * from a clean one. `R-0038`'s argument is why this matters. The damage done by a passing run was
 * never that it failed to block something, but that it meant less than its reader believed.
 *
 * The function has no side effects and is exported, because here the wording is the mechanism, and
 * wording that nothing exercises drifts. `tests/check.test.js` fixes the wording of both branches.
 */
export function postponementSummary({ postponed, excused, why, until }) {
  const paid =
    excused.length > 0
      ? `⚠️ ${excused.join(', ')} FAILED above and ${excused.length === 1 ? 'was' : 'were'} ` +
        `excused, so this run exits 0 with a check genuinely failing.`
      : 'Nothing was excused on this run.';

  return (
    `⚠️ POSTPONED: ${[...postponed].join(', ')} — a failure there exits 0. ${paid} ` +
    `Reason: ${why} Restored by: ${until}.`
  );
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

  // The policy is read before any check runs. A malformed 'check' block is a failure of its own.
  // Discovering it only after a finding would make the configuration's own error depend on the
  // state of the store.
  const configPath = store.configPath ?? 'jtrek.json';
  const policy = enforcement(store.config, configPath);

  const failed = [];
  /** These are checks that failed but were postponed by the policy, so they do not fail the run. */
  const excused = [];

  /**
   * This records one check's verdict. The caller still prints a postponed failure in full. This
   * function decides only whether the failure changes the exit code.
   */
  function settle(name, ok) {
    if (ok) return;
    if (policy.postponed.has(name)) excused.push(name);
    else failed.push(name);
  }

  // --- history ---------------------------------------------------------------------------------

  const history = inspectHistory({ registryPath: store.registryPath, since: args.since });

  // "Nothing could be checked" and "the check passed" both exit 0, and the wording is the only
  // thing that tells them apart.
  if (!history.verifiable) {
    logger.info(`history      NOT CHECKED — ${history.reason}`);
  } else if (history.violations.length === 0) {
    logger.info(
      `history      ok — ${history.added} line(s) added at the end of ${history.tracked}, none of ` +
        `its ${history.baseLines} existing line(s) touched, against '${history.since}'.`
    );
  } else {
    logger.error(
      `history      FAILED — ${history.tracked} was altered rather than appended to, against ` +
        `'${history.since}':`
    );
    for (const violation of history.violations) logger.error(`  ${violation.message}`);
    // This remedy is not printed under a whole-file rewrite. That finding may be a migration, and
    // then restoring the file would undo work the tool was asked to do. The message above already
    // says what to do in either case. R-000155 is the decision.
    if (!history.wholeFile) {
      logger.error(
        `  → R1 says a person never writes the registry; jtrek does. Restore the file with ` +
          `'git checkout ${history.since} -- ${history.tracked}', then make the change with ` +
          `'jtrek checkout' → edit work.json → 'jtrek checkin'.`
      );
    }
    settle('history', false);
  }

  // --- chain, references and registry-md --------------------------------------------------------

  const { db, records: rows } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });

  // The chain is verified over the rows in file order, which is the order `openStore` returns and
  // the order the chain is computed over. Every other group below reads the database instead, and
  // the database has no order of its own.
  const breaks = chainBreaks(rows);

  let references;
  let registryMdMatches;
  let current;
  try {
    references = inspectReferences({
      rows,
      storeDir: store.dir,
      recordsDir: store.recordsDir,
      until: policy.until,
      pending: openCheckoutProse(store.workPath, store.dir),
    });
    // This is the same comparison that `jtrek build --check` makes. It is called rather than
    // reimplemented, so that the two can never disagree. `handoff.js:gather` reuses it in the same
    // way.
    current = currentRecords(db);
    const rendered = render(db, current);
    const committed = fs.existsSync(store.registryMdPath)
      ? readText(store.registryMdPath)
      : null;
    registryMdMatches = committed === rendered;
  } finally {
    db.close();
  }

  if (rows.length === 0) {
    logger.info(
      `chain        NOT CHECKED — ${store.dir} holds no rows yet. The chain starts at the first ` +
        `row a check-in writes.`
    );
  } else if (breaks.length === 0) {
    logger.info(
      `chain        ok — ${rows.length} row(s), each carrying the value its contents and its ` +
        `place in the file produce.`
    );
  } else {
    logger.error(`chain        FAILED — ${breaks.length} of ${rows.length} row(s) do not verify:`);
    for (const item of breaks) {
      logger.error(
        `  row ${item.position} (${item.id} rev ${item.rev}): carries ` +
          `${String(item.stored).slice(0, 12)}…, and its contents and position produce ` +
          `${item.expected.slice(0, 12)}….`
      );
    }
    // Each row is judged against the value stored on the row before it, rather than against the
    // value computed here. The rows named above are therefore the rows that are actually wrong,
    // and not every row after the first fault. The remedy can therefore speak about them directly.
    logger.error(
      `  → A row's chain covers its own fields and the row before it, so a row that does not ` +
        `verify was written by something other than the loop: edited after it was written, moved, ` +
        `or typed in at the end of the file. jtrek computes this value and a person never does. ` +
        `Restore the file from the last commit that verified, then make the change with ` +
        `'jtrek checkout' → edit work.json → 'jtrek checkin'. A row whose own fields are ` +
        `untouched fails only because a row before it moved or changed, so look above the first ` +
        `one named here.`
    );
    settle('chain', false);
  }

  const referenceProblems =
    references.unresolved.length +
    references.dangling.length +
    references.orphans.length +
    references.sharedProse.length +
    references.misnamed.length +
    references.badKinds.length +
    references.danglingUntil.length;

  if (referenceProblems === 0) {
    // The clause about the postponement is printed only when there is a postponement. A run with no
    // `check` block verified nothing about `until`, and it should not read as though it had.
    const postponementClause =
      policy.until === null ? '' : `, the postponement's 'until' names a record that exists`;
    logger.info(
      `references   ok — across ${references.rows} row(s): every detail_ref resolves, every ` +
        `supersedes, split_from and related names a record that exists${postponementClause}, ` +
        `every related group uses a kind the vocabulary holds, no prose file is unreferenced, ` +
        `none is named by two records, and each in records/ is named for its record.`
    );
  } else {
    logger.error(`references   FAILED — ${referenceProblems} problem(s) across ${references.rows} row(s):`);
    for (const item of references.unresolved) {
      logger.error(
        `  ${item.id} rev ${item.rev}: detail_ref '${item.ref}' does not exist, relative to ${store.dir}.`
      );
    }
    for (const item of references.dangling) {
      logger.error(
        `  ${item.id} rev ${item.rev}: '${item.field}' names ${item.target}, which is not in the store.`
      );
    }
    for (const orphan of references.orphans) {
      logger.error(`  ${orphan} is not referenced by any row's detail_ref.`);
    }
    for (const item of references.sharedProse) {
      logger.error(`  ${item.ref} is named by ${item.ids.join(' and ')}; a prose file belongs to one record.`);
    }
    for (const item of references.misnamed) {
      logger.error(
        `  ${item.id} rev ${item.rev}: detail_ref '${item.ref}' is not named for ${item.id}; ` +
          `it should be '${item.expected}'.`
      );
    }
    for (const item of references.badKinds) {
      logger.error(
        `  ${item.id} rev ${item.rev}: 'related' groups ids under '${item.kind}', which is not ` +
          `a kind. The kinds are ${RELATION_KINDS.join(', ')}.`
      );
    }
    for (const item of references.danglingUntil) {
      logger.error(
        item.target === null
          ? `  ${configPath}: 'check.until' reads '${item.until}', which names no record.`
          : `  ${configPath}: 'check.until' names ${item.target}, which is not in the store.`
      );
    }
    // Each remedy is printed only under the kind of problem it describes, and each of the seven
    // kinds of finding has one. R-0086 split what had been a single shared remedy line. That line
    // spoke about R2, which concerns a prose file checked in before it was written, so printing it
    // under an orphaned file or a bad 'until' told the reader to do the wrong thing. R-0089 is the
    // record for the remedies under a missing file, a dangling link, an orphaned file and a bad
    // 'until'. The remedies for shared prose, misnamed prose and an unknown kind of relation were
    // added later, with the checks they belong to.
    //
    // No remedy cites a record id, because this output is read in adopting projects, whose stores
    // do not hold jtrek's own records. R-0093 established that constraint for the shipped
    // documents, R-0098 applied it to the schema reference, and R-000132 applied it to everything
    // the commands print, with tests/citations.test.js as the guard. Rule names such as R1 are safe
    // to print, because `jtrek agent install` writes them into the adopting project's own rules.
    if (references.unresolved.length > 0) {
      logger.error(
        `  → A missing prose file means a revision was checked in before its prose was written, ` +
          `which is R2. One file serves every revision of a record, so write it at the path the ` +
          `row names; if the path itself is wrong, add a revision naming the right one. Do not ` +
          `clear 'detail_ref' — check-in refuses a revision that does, because clearing the ` +
          `field hides the prose rather than unwriting it. Never delete the row.`
      );
    }
    if (references.dangling.length > 0) {
      logger.error(
        `  → A link naming a record the store does not hold is one of two cases, and the field ` +
          `named above says which. A 'supersedes' or 'split_from' did not arrive through the ` +
          `loop at all: check-in refuses a new one whose target is not in the checkout, so that ` +
          `row was written some other way, which is R1. A 'related' can reach the store through ` +
          `the loop, because it writes no revision of the record it names and so requires no ` +
          `checkout; a dangling one is an id that is wrong or a record never written. Either ` +
          `way: if the id is wrong, add a revision of this record carrying the right one. If the ` +
          `record the link names was never written, write it. Never edit the row in place.`
      );
    }
    if (references.orphans.length > 0) {
      logger.error(
        `  → A prose file no row names is invisible to 'jtrek query', and it is one of two ` +
          `things. If it is the prose of a record the store already holds, add a revision of ` +
          `that record naming the file in 'detail_ref'. If it was written for a record that was ` +
          `never checked in, the row is what is missing: write it, or delete the file if the ` +
          `work is not wanted.`
      );
    }
    if (references.sharedProse.length > 0) {
      logger.error(
        `  → A prose file opens by stating one record's problem, so a second record naming it ` +
          `sends its readers to a subject that is not theirs. Give every record but one a file of ` +
          `its own. Where a record needs prose another already holds, link to it from that record's ` +
          `own file rather than naming it in 'detail_ref' — a pointer is not a duplicate, and it ` +
          `leaves each file belonging to one record. Check-in refuses this, so a row carrying it ` +
          `reached the registry another way, which is R1.`
      );
    }
    if (references.misnamed.length > 0) {
      logger.error(
        `  → A reader who has a record's id opens records/<id>.md directly, without a query, so a ` +
          `prose file under another name is one that reader never finds. Move the prose to the ` +
          `path named above, and add a revision of the record naming that path. Check-in refuses ` +
          `this, so a row carrying it reached the registry another way, which is R1.`
      );
    }
    if (references.badKinds.length > 0) {
      logger.error(
        `  → A kind outside the vocabulary is not a visible error but a silent one: the row ` +
          `stores, and every search that asks for a relation by kind skips it without saying ` +
          `so. Check-in refuses an unknown kind, so a row carrying one reached the registry ` +
          `another way, which is R1. Add a revision of this record regrouping those ids under ` +
          `the kind meant. The records they name do NOT have to be checked out.`
      );
    }
    if (references.danglingUntil.length > 0) {
      logger.error(
        `  → 'until' says what would restore a postponed check, and the only end this command ` +
          `can check is whether a named record exists. Name the record that removes the ` +
          `postponement, and write that record if it does not exist yet.`
      );
    }
    settle('references', false);
  }
  // A file accepted because of the open checkout is named whether the group passed or failed, so
  // that a reader can tell it apart from a file that a row names (R-000549).
  for (const item of references.accepted) {
    logger.info(
      `  ${item.file} is named by ${item.id} in the open checkout, so it is not reported as ` +
        `unreferenced until that checkout is checked in.`
    );
  }

  if (registryMdMatches) {
    logger.info(`registry-md  ok — the committed registry.md equals a fresh render of the store.`);
  } else {
    logger.error(
      `registry-md  FAILED — ${store.registryMdPath} does not equal the store. ` +
        `Run 'jtrek build' and commit the result.`
    );
    settle('registry-md', false);
  }

  // --- markdown ----------------------------------------------------------------------------------

  const targets = markdownTargets(store, configPath);

  // There are two ways for this group to check nothing, and both must say so rather than report
  // ok. Opting out is the project's decision. An empty list means a store that holds no prose yet,
  // which a project has only before its first record. Reporting either case as ok would print a
  // passing line under a check that read no document at all.
  if (targets === null) {
    logger.info(
      `markdown     NOT CHECKED — ${configPath} sets 'markdown' to false, so no document is ` +
        `checked. Remove that to restore the check.`
    );
  } else if (targets.length === 0) {
    logger.info(
      `markdown     NOT CHECKED — ${store.dir} holds no prose to check yet, and ${configPath} ` +
        `names no document outside it. The check starts reporting at the first prose file.`
    );
  } else {
    const findings = inspectMarkdown(targets, store.projectRoot);
    if (findings.length === 0) {
      logger.info(
        `markdown     ok — ${targets.length} document(s) carry none of the ${SIGNATURE_NAMES.length} ` +
          `signatures a rewriting editor leaves.`
      );
    } else {
      const hits = findings.reduce((sum, finding) => sum + finding.hits.length, 0);
      logger.error(
        `markdown     FAILED — ${hits} instance(s) across ${new Set(findings.map((f) => f.file)).size} ` +
          `of ${targets.length} document(s):`
      );
      for (const finding of findings) {
        logger.error(`  ${finding.file}: ${finding.title}`);
        for (const hit of finding.hits) logger.error(`    line ${hit.line}: ${hit.text}`);
        logger.error(`    → ${finding.remedy}`);
      }
      // This line is printed once under the whole group, and it is worded so that it is true of
      // every signature. Most of the signatures are left by an editor that rewrites a file on save.
      // Repairing them in that same editor writes the damage straight back, and that is the one
      // thing a reader has to know before starting. The line does not claim that every finding
      // above had that cause, because a missing final newline can come from anything. R-0089
      // records what a remedy printed under a finding it does not describe costs the reader. R-0092
      // records an editor rewriting these documents without being asked, and R-0119 records this
      // check. Those ids stay in this comment rather than in the printed line, because an adopting
      // project's store does not hold them (R-000132).
      logger.error(
        `  → Repair these in an editor that edits bytes rather than one that reformats on save.`
      );
      settle('markdown', false);
    }
  }

  // --- plan --------------------------------------------------------------------------------------

  // This group runs here, among the gates, so that a record left naming a section the plan no longer
  // has is reported at every close without anybody remembering to run `jtrek plan check`. The
  // owner chose this on 2026-09-26 (`R-000192`).
  const planPath = path.join(store.dir, PLAN_FILENAME);
  const planText = fs.existsSync(planPath) ? readText(planPath) : null;
  const plan = planFindings(inspectPlan(planText, current), planPath);
  if (!plan.checked) {
    logger.info(`plan         NOT CHECKED — ${plan.summary}`);
  } else if (plan.problems.length === 0) {
    logger.info(`plan         ok — ${plan.summary}`);
  } else {
    logger.error(`plan         FAILED — ${plan.problems.length} problem(s):`);
    for (const problem of plan.problems) logger.error(`  ${problem}`);
    for (const remedy of plan.remedies) logger.error(`  → ${remedy}`);
    settle('plan', false);
  }

  // --- spec --------------------------------------------------------------------------------------

  // This group runs among the gates for the reason the `plan` group does. A requirement naming a
  // feature the spec has no heading for is rendered nowhere, so nothing else would show it.
  const specPath = path.join(store.dir, SPEC_FILENAME);
  const specText = fs.existsSync(specPath) ? readText(specPath) : null;
  const spec = specFindings(inspectSpec(specText, current), specPath);
  if (!spec.checked) {
    logger.info(`spec         NOT CHECKED — ${spec.summary}`);
  } else if (spec.problems.length === 0) {
    logger.info(`spec         ok — ${spec.summary}`);
  } else {
    logger.error(`spec         FAILED — ${spec.problems.length} problem(s):`);
    for (const problem of spec.problems) logger.error(`  ${problem}`);
    for (const remedy of spec.remedies) logger.error(`  → ${remedy}`);
    settle('spec', false);
  }

  // --- tests -------------------------------------------------------------------------------------

  // This group runs among the gates for the reason the `spec` group does. A requirement is in force
  // only once a passing test verifies it (R-000371), and a requirement whose link to that test was
  // never made, or has since broken, would otherwise be listed in the spec with nothing showing it.
  const links = testLinkFindings(inspectTestLinks(current, store.projectRoot));
  if (!links.checked) {
    logger.info(`tests        NOT CHECKED — ${links.summary}`);
  } else if (links.problems.length === 0) {
    logger.info(`tests        ok — ${links.summary}`);
  } else {
    logger.error(`tests        FAILED — ${links.problems.length} problem(s):`);
    for (const problem of links.problems) logger.error(`  ${problem}`);
    for (const remedy of links.remedies) logger.error(`  → ${remedy}`);
    settle('tests', false);
  }

  // --- verdict -----------------------------------------------------------------------------------

  // The postponement is stated on an entirely clean run too, and that is deliberate. A reader who
  // sees only passing lines cannot tell an enforced gate from a postponed one, and would carry
  // that mistaken belief into every later run.
  if (policy.postponed.size > 0) {
    logger.info(
      postponementSummary({
        postponed: policy.postponed,
        excused,
        why: policy.why,
        until: policy.until,
      })
    );
  }

  if (failed.length > 0) {
    logger.error(`${failed.length} of ${CHECKS.length} check(s) failed: ${failed.join(', ')}.`);
    return 1;
  }
  return 0;
}
