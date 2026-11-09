/**
 * src/commands/handoff.js implements `jtrek handoff`, which gathers the facts needed to write the
 * hand-off.
 *
 * This command writes no prose, and it is not meant to. It gathers the facts that go out of date:
 * how much work is open, what is parked, what needs a person and where the branch stands. It refuses when the store is not in a fit state to write a
 * hand-off from. The text of the hand-off is written by whichever agent is running the session,
 * because two judgements that a hand-off depends on can only be made by someone who was present:
 *
 *   - The first is what has no record yet. A diff records what changed, but never what somebody
 *     decided not to do. An abandoned approach or a premise that turned out to be false leaves
 *     nothing on disk, so no tool that reads the repository can find it. Only the agent that was
 *     present can.
 *   - The second is what no longer affects anyone's next step. When deleting from the hand-off, the
 *     question is whether a new session with no memory of today would act differently if a
 *     paragraph were missing. Whether the paragraph is still true is not the question.
 *
 * This follows the same pattern the store already uses. `checkout` writes out a set of records and
 * the agent edits it. `handoff` writes out the facts and the agent writes the hand-off from them.
 * In both cases jtrek owns the mechanism and refuses bad input, and the agent owns the words.
 *
 * Every figure is recalculated on every run. The typical failure of a hand-off is a number that was
 * true last week, so nothing is cached and nothing is read back from an earlier run.
 *
 * Usage:
 *   jtrek handoff            the evidence, for a person to read
 *   jtrek handoff --json     the same, for an agent to consume
 *   jtrek handoff --since <ref>   records revised since a git ref (default: origin/HEAD)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { currentRecords, openStore } from '../store.js';
import { render } from './build.js';
import { targets } from './agent.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/handoff');

export const USAGE = `
Usage: jtrek handoff [--json] [--since <ref>]

  --json          machine-readable output for an agent
  --since <ref>   measure the branch against this ref (default: the upstream branch)
`.trim();

export function parseArgs(argv) {
  const args = { json: false, since: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') {
      args.json = true;
    } else if (flag === '--since') {
      if (!argv[i + 1]) throw new UsageError('--since needs a git ref');
      args.since = argv[i + 1];
      i += 1;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
      return args;
    } else {
      throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }
  return args;
}

/**
 * This is how much output a git call here may produce before `spawnSync` gives up.
 *
 * The default limit is 1 MiB, and a real store exceeds it. `rowsSinceLastHandoff` runs `git show`
 * of the registry as it stood at the last hand-off commit, so its output is the whole registry.
 * Once this repository's registry grew past 1 MiB, that call failed with `ENOBUFS`. The failure
 * looked like any other git failure, so the function reported that git could not read a file which
 * git reads without difficulty, and both `jtrek handoff` and `jtrek start` stopped. `R-000156`
 * found the same limit in `check.js`, and the ceiling here is the one chosen there.
 */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/**
 * Runs a git command in the project and returns its trimmed stdout, or null.
 *
 * It deliberately returns null on any failure. A store outside a git repository is unusual but
 * not wrong. A new branch has no upstream yet, and a hand-off command that failed for that reason
 * would be useless in exactly the situation where it is most wanted. What must never happen is a
 * guessed figure. A missing answer therefore stays null all the way to the output, where it is
 * shown as unknown.
 */
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim();
}

/**
 * Returns the branch, its upstream, how far ahead and behind it is, and how many files are
 * uncommitted.
 *
 * Whether git is available is decided with `--is-inside-work-tree`, and the branch is read with
 * `--show-current`. `rev-parse HEAD` is not used, because it fails in a repository that has no
 * commits yet. Using it would report a newly initialised project as having no git at all.
 */
export function gitState(projectRoot, since) {
  if (git(projectRoot, 'rev-parse', '--is-inside-work-tree') !== 'true') {
    return { available: false };
  }
  // The branch name is empty when HEAD is detached, which is a legitimate state and not an error.
  const branch = git(projectRoot, 'branch', '--show-current') || null;

  const base = since ?? git(projectRoot, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  const counts = base ? git(projectRoot, 'rev-list', '--left-right', '--count', `${base}...HEAD`) : null;
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [null, null];
  const dirty = git(projectRoot, 'status', '--porcelain');

  return {
    available: true,
    branch,
    base: base ?? null,
    ahead,
    behind,
    uncommitted: dirty === null ? null : dirty.split('\n').filter(Boolean).length,
  };
}

/**
 * The rows added to the registry since the hand-off was last committed, split into new records and
 * revisions of existing ones.
 *
 * This function exists because asking a session to remember cannot catch what it has forgotten,
 * as `R-0055` found. Step 1 of the closing procedure asks the session what it finished, decided,
 * abandoned or worked around. A session that forgot something answers that question without it. A
 * count of rows needs no memory. A count of zero is allowed, but it states that the whole session
 * recorded nothing, and reading that figure is a different experience from being asked to recall.
 *
 * The starting point for the count is the last commit that changed the hand-off, and it is read
 * from git rather than stored anywhere. jtrek has no concept of a session, so something has to
 * stand for "since the last close-out". The closing procedure ends every close-out with one commit
 * containing the hand-off, as `R-0066` set out, so that commit moves forward once per close-out.
 * Running this command again, or running `jtrek start`, does not move it. A starting point written
 * by either command would move. The count is wrong only when the hand-off was committed partway
 * through a session.
 *
 * Revisions are counted as well as new records, because revising a record is just as much the work
 * that rule R4 asks for. A row is identified by its id and rev, so a row that already existed at
 * the starting point is never counted again.
 *
 * When there is no git history to read a starting point from, the function returns
 * `{ available: false, why }`. The report then says that the figure is unknown rather than guessing
 * one.
 */
export function rowsSinceLastHandoff(store, rows) {
  const { handoffFile } = targets(store);
  const mark = git(store.projectRoot, 'log', '-1', '--format=%H', '--', handoffFile);
  if (!mark) {
    return { available: false, why: `${handoffFile} has never been committed, or this is not a git repository.` };
  }

  // The `./` prefix makes the path relative to the directory git runs in. That directory is the
  // project root, which is not necessarily the root of the repository.
  const registryAtMark = `${mark}:./${path.relative(store.projectRoot, store.registryPath)}`;
  const seen = new Set();
  if (git(store.projectRoot, 'cat-file', '-e', registryAtMark) !== null) {
    const text = git(store.projectRoot, 'show', registryAtMark);
    if (text === null) {
      logger.error(`git could not read ${registryAtMark}, although it exists.`);
      throw new Error(`git could not read ${registryAtMark}.`);
    }
    for (const lineText of text.split('\n')) {
      if (lineText.trim() === '') continue;
      const parsed = JSON.parse(lineText);
      if (parsed.id !== undefined) seen.add(`${parsed.id}@${parsed.rev}`);
    }
  }

  const added = rows.filter((row) => !seen.has(`${row.id}@${row.rev}`));
  const idsAtMark = new Set([...seen].map((key) => key.split('@')[0]));
  const created = [...new Set(added.filter((row) => !idsAtMark.has(row.id)).map((row) => row.id))];
  const revised = [...new Set(added.filter((row) => idsAtMark.has(row.id)).map((row) => row.id))];

  return { available: true, mark: mark.slice(0, 7), rows: added.length, created, revised };
}

/**
 * Collects everything that a hand-off is written from.
 *
 * It is exported for two reasons. Tests can check the facts directly without parsing formatted
 * output, and a future caller, such as a plugin or an MCP server, can get the same data without
 * running the command in a shell.
 *
 * `countSinceHandoff: false` leaves out the count of rows added since the hand-off was last
 * committed, and `sinceLastHandoff` is then null. `jtrek start` passes it, because `start` never
 * shows that count and is documented to exit 0 whatever it finds. Reading the count asks git for
 * the registry at an earlier commit, and that can fail, for example on a corrupt object. When
 * `start` computed the count anyway, such a failure made it print only the error and exit 1.
 * `R-000209` records that defect. `jtrek handoff` still computes the count, and a failure there
 * still stops it, because `handoff` is a gate.
 */
export function gather(store, { since = null, countSinceHandoff = true } = {}) {
  const { db, records: allRows } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });

  let current;
  let registryMdMatches;
  try {
    current = currentRecords(db);
    // This is the same comparison that `build --check` makes. It is included because a hand-off
    // written while registry.md is out of date would quote numbers that the committed file does
    // not agree with.
    const rendered = render(db, current);
    const committed = fs.existsSync(store.registryMdPath)
      ? readText(store.registryMdPath)
      : null;
    registryMdMatches = committed === rendered;
  } finally {
    db.close();
  }

  // A requirement is a statement of what must be true of the product, and it is `open` while it is
  // proposed and waits for the owner's review. It is not a piece of work, so it is left out of the
  // open work and reported on its own below. Counting it as work would let a batch of drafted
  // requirements swamp both the figures here and the candidates `jtrek start` offers (`R-000368`).
  const openWork = current.filter(
    (record) =>
      (record.status === 'open' || record.status === 'in-progress') && record.type !== 'requirement'
  );
  const byType = {};
  for (const record of openWork) byType[record.type] = (byType[record.type] ?? 0) + 1;

  // A record of `type: question` is defined as a decision the owner has not yet made. What needs a
  // person can therefore be found by a query, rather than kept as a list that somebody maintains
  // by hand. The skill this procedure was adapted from called that list the part of a hand-off
  // most likely to go out of date.
  const needsAPerson = current.filter(
    (record) => record.type === 'question' && record.status === 'open'
  );
  const deferred = current.filter((record) => record.status === 'deferred');

  // The proposed requirements are gathered for `jtrek start`, which uses them to recognise a
  // hand-off that names one. Neither command prints them. The owner ruled that requirement figures
  // belong on the dashboard of `jtrek view` (`R-000376`), so `run` below leaves them out of the
  // hand-off figures, the JSON output included.
  const proposedRequirements = current.filter(
    (record) => record.type === 'requirement' && record.status === 'open'
  );

  // Planned records are reported separately from deferred ones, because the two are set aside for
  // different reasons and call for different actions from the reader. A deferred record waits on a
  // condition that somebody can go and check. A planned record waits on nothing and is simply not
  // next. A single heading covering both would leave the reader to work out which kind each row is.
  const planned = current.filter((record) => record.status === 'planned');

  // A work.json without a check-in stamp holds edits that exist nowhere else. A hand-off written
  // while one is open describes a store that does not yet contain the session's work.
  const checkout = readCheckout(store.workPath);

  const blockers = [];
  if (checkout.open) {
    blockers.push(
      `${store.workPath} holds an unfinished checkout — run 'jtrek checkin' before writing the ` +
        `hand-off, or the session's work is not in the store yet.`
    );
  }
  if (!registryMdMatches) {
    blockers.push(
      `${store.registryMdPath} does not match the store — run 'jtrek build' and commit the result.`
    );
  }

  return {
    store: store.dir,
    rows: allRows.length,
    records: current.length,
    open: { total: openWork.length, byType, records: openWork },
    needsAPerson,
    proposedRequirements,
    deferred,
    planned,
    checkout,
    registryMdMatches,
    git: gitState(store.projectRoot, since),
    sinceLastHandoff: countSinceHandoff ? rowsSinceLastHandoff(store, allRows) : null,
    blockers,
  };
}

/** Returns whether a checkout is open, and what it holds. */
function readCheckout(workPath) {
  if (!fs.existsSync(workPath)) return { present: false, open: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(workPath, 'utf8'));
    const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
    return {
      present: true,
      open: !parsed.checked_in,
      checkedIn: parsed.checked_in ?? null,
      selector: parsed.selector ?? null,
      ids: records.map((record) => record?.id).filter(Boolean),
    };
  } catch {
    // A file that cannot be read is treated as an open checkout, as `checkout` also does. Such a
    // file may still hold work, and assuming that it is finished is how that work would be lost.
    return { present: true, open: true, unreadable: true, ids: [] };
  }
}

function line(label, value) {
  return `  ${`${label}:`.padEnd(22)}${value}`;
}

function format(facts) {
  const out = [];

  out.push('# Hand-off evidence', '');
  out.push(`Store: ${facts.store}`);
  out.push(`${facts.records} record(s), folded from ${facts.rows} row(s).`, '');

  out.push('## Open work', '');
  if (facts.open.total === 0) {
    out.push('  Nothing open.');
  } else {
    out.push(line('total', facts.open.total));
    for (const [type, count] of Object.entries(facts.open.byType).sort()) {
      out.push(line(`  ${type}`, count));
    }
  }
  out.push('');

  out.push('## Needs a person (open questions)', '');
  out.push(
    facts.needsAPerson.length === 0
      ? '  Nothing waiting on the owner.'
      : facts.needsAPerson.map((record) => `  ${record.id}  ${record.title}`).join('\n')
  );
  out.push('');

  out.push('## Settled, but not startable yet', '');
  out.push(
    facts.planned.length === 0
      ? '  Nothing is planned.'
      : facts.planned
          .map((record) => `  ${record.id}  ${record.title}\n${' '.repeat(12)}${record.note}`)
          .join('\n')
  );
  out.push('');

  out.push('## Parked, with the condition that would restart it', '');
  out.push(
    facts.deferred.length === 0
      ? '  Nothing is parked.'
      : facts.deferred
          .map((record) => `  ${record.id}  ${record.title}\n${' '.repeat(12)}${record.note}`)
          .join('\n')
  );
  out.push('');

  out.push('## Where things stand', '');
  if (!facts.git.available) {
    out.push('  Not a git repository, or git is unavailable.');
  } else {
    out.push(line('branch', facts.git.branch));
    out.push(line('measured against', facts.git.base ?? 'no upstream — pass --since <ref>'));
    out.push(line('ahead / behind', facts.git.ahead === null ? 'unknown' : `${facts.git.ahead} / ${facts.git.behind}`));
    out.push(line('uncommitted files', facts.git.uncommitted ?? 'unknown'));
  }
  out.push(line('checkout open', facts.checkout.open ? `yes — ${facts.checkout.ids.join(', ') || 'no ids'}` : 'no'));
  out.push(line('registry.md', facts.registryMdMatches ? 'matches the store' : 'STALE'));
  out.push('');

  out.push('## Recorded since the last hand-off commit', '');
  const since = facts.sinceLastHandoff;
  if (!since.available) {
    out.push(`  Unknown. ${since.why}`);
  } else {
    out.push(line('measured from', since.mark));
    out.push(line('rows added', since.rows));
    out.push(line('new records', since.created.length === 0 ? 'none' : since.created.join(', ')));
    out.push(line('revised records', since.revised.length === 0 ? 'none' : since.revised.join(', ')));
    if (since.rows === 0) {
      out.push('', '  ⚠️ Zero rows states that this session found nothing worth recording.');
    }
  }
  out.push('');

  if (facts.blockers.length > 0) {
    out.push('## Not ready to write a hand-off', '');
    out.push(...facts.blockers.map((blocker) => `  - ${blocker}`));
    out.push('');
  }

  return out.join('\n');
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const { proposedRequirements: _notPrinted, ...facts } = gather(store, { since: args.since });

  process.stdout.write(args.json ? `${JSON.stringify(facts, null, 2)}\n` : `${format(facts)}\n`);

  if (facts.blockers.length > 0) {
    logger.error(`${facts.blockers.length} blocker(s) — the store is not ready for a hand-off.`);
    return 1;
  }
  return 0;
}
