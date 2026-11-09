/**
 * src/commands/start.js implements `jtrek start`, which gathers the facts needed to decide what a
 * session works on.
 *
 * It is the counterpart to `handoff`, and it divides the work in the same way. `handoff` gathers
 * the facts that a closing session writes the hand-off from, and this command gathers the facts
 * that an opening session chooses its work from. In both, jtrek supplies the evidence and a person
 * or agent supplies the judgement. Here the judgement is which record to take, and it belongs to
 * the owner.
 *
 * The command writes nothing and takes nothing. The whole opening procedure only reads, so that a
 * `jtrek checkout` continues to mean that the work was taken, and not merely that somebody looked
 * at it. An orchestrating agent will later need to rely on that meaning of a checkout, as `R-0021`
 * explains.
 *
 * The command always exits with 0, unlike `handoff`, which is a gate. The blockers it finds are
 * reported prominently and are never offered as candidates, but none of them is a reason to fail.
 * If they were, a session resuming an interrupted record would open by reading an error. Nothing
 * that runs afterwards depends on the exit code, because nothing afterwards is automatic. A person
 * chooses what happens next.
 *
 * The ranking rule is fixed and is printed with the output, so that a reader can disagree with it
 * on specific grounds. An opening that produced three plausible options with no stated reason
 * would be a menu rather than a basis for a decision. That is the failure `R-0047` was raised
 * about.
 *
 * Usage:
 *   jtrek start                 the evidence, for a person to read
 *   jtrek start --json          the same, for an agent to consume
 *   jtrek start --limit <n>     how many candidates to shortlist (default 5, 0 for all)
 */

import fs from 'node:fs';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { gather } from './handoff.js';
import { guardCommandProblem, instructionProblems, targets } from './agent.js';
import { compareIds } from '../store.js';
import { NUMBERED, planSections } from '../plan.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/start');

export const USAGE = `
Usage: jtrek start [--json] [--limit <n>]

  --json        machine-readable output for an agent
  --limit <n>   how many candidates to shortlist (default 5; 0 means all)

Writes nothing and takes nothing. Run 'jtrek checkout' once the owner has chosen.
`.trim();

/** The number of candidates a reader can take in before the list stops being a shortlist. */
const DEFAULT_LIMIT = 5;

export function parseArgs(argv) {
  const args = { json: false, limit: DEFAULT_LIMIT, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') {
      args.json = true;
    } else if (flag === '--limit') {
      const value = Number(argv[i + 1]);
      if (!argv[i + 1] || !Number.isInteger(value) || value < 0) {
        throw new UsageError('--limit needs a whole number of candidates, 0 or more');
      }
      args.limit = value;
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

/** The heading of the hand-off section that names what a person decided to do next. */
const START_HERE = /^##\s+start here\s*$/im;
// The pattern uses `{4,}` rather than `{4}`. Ids have at least four digits, and jtrek pads new
// ones to six. A fixed count of four would match `R-1000` inside `R-100000`, and so would name a
// record other than the one written.
const RECORD_ID = /R-\d{4,}/g;

/** A markdown table row, which is a line whose first non-space character is a pipe. */
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;

/** The `|---|:--:|` line under a table's header, which carries no content. */
const SEPARATOR_ROW = /^[\s|:-]+$/;

/**
 * Returns the record ids that the hand-off names as the next thing to do, in the order it names
 * them.
 *
 * Only the "Start here" section is read, and the function never falls back to reading the whole
 * document. A hand-off mentions records throughout, for example in "Where the deep detail lives"
 * or in a warning about something already closed. Treating those mentions as a person's intent
 * would produce an ordering that nobody wrote. A hand-off without a "Start here" section names
 * nothing, and that is reported as a fact rather than worked around.
 *
 * Within the section, only the first cell of each table row is read. The section is a table. Its
 * first column holds the record to pick up. Its later columns hold background, namely the records a
 * session should read before starting, which are not themselves work. An earlier version read the
 * whole section and could not tell the two apart. On 2026-08-24 it offered R-0062 as the second
 * thing to work on, although R-0062 was a closed decision, named only to explain why a comment in
 * R-0063 needed correcting. Putting the two kinds of record in separate columns makes the
 * difference part of the table's structure, so the parser no longer has to interpret English to
 * find it.
 *
 * A cell may hold more than one id, and those records are then meant to be worked on together.
 * For example, `R-0025` and `R-0026` edit the same function and are worth taking together, so a
 * row naming both is intended rather than a mistake.
 *
 * Prose under the table is not read at all. A warning about a row belongs there, and a record
 * mentioned in that warning cannot become a candidate.
 *
 * The order is the order in which the ids appear, and it says nothing about importance. The
 * ranking rule is printed so that a wrong order can be challenged rather than simply followed.
 */
export function namedInHandoff(text) {
  if (text === null) return { present: false, section: false, table: false, ids: [] };

  const start = text.search(START_HERE);
  if (start === -1) return { present: true, section: false, table: false, ids: [] };

  const rest = text.slice(start + text.slice(start).indexOf('\n'));
  const next = rest.search(/^##\s+/m);
  const section = next === -1 ? rest : rest.slice(0, next);

  // The header row is whichever table row comes first, and it names columns rather than records.
  // It is dropped by its position rather than by matching its wording, so this keeps working
  // whatever the columns are called.
  const rows = [];
  for (const line of section.split('\n')) {
    const match = line.match(TABLE_ROW);
    if (!match) continue;
    if (SEPARATOR_ROW.test(match[1])) continue;
    rows.push(match[1]);
  }
  if (rows.length === 0) return { present: true, section: true, table: false, ids: [] };

  const ids = new Set();
  for (const row of rows.slice(1)) {
    const first = row.split('|')[0];
    for (const id of first.match(RECORD_ID) ?? []) ids.add(id);
  }

  return { present: true, section: true, table: true, ids: [...ids] };
}

/**
 * Returns true when a session could take the record as work. That means the record is open, and is
 * neither a question waiting for the owner's decision nor a requirement waiting for the owner's
 * review. A requirement states what must be true of the product rather than a piece of work, so it
 * is reported on its own instead (`R-000368`).
 */
function isCandidate(record) {
  return record.status === 'open' && record.type !== 'question' && record.type !== 'requirement';
}

/**
 * Collects everything that the decision at the opening of a session is made from.
 *
 * It is exported for two reasons. Tests can check the facts directly without parsing formatted
 * output, and a later caller, such as a plugin or an MCP server, can get the same data without
 * running the command in a shell.
 */
export function collect(store, { limit = DEFAULT_LIMIT } = {}) {
  // The count of rows since the last hand-off is left out, because this command never shows it,
  // and computing it can fail in a way that would stop the command exiting 0. See `gather`.
  const facts = gather(store, { countSinceHandoff: false });
  const t = targets(store);

  const handoffText = readIfPresent(t.handoffFile);
  const handoff = namedInHandoff(handoffText);
  const sections = planSections(readIfPresent(t.planDoc));

  // Proposed requirements are not open work, but the hand-off can still name one, and the report
  // must then say that it is not work rather than that the store has closed it.
  const byId = new Map(
    [...facts.open.records, ...facts.proposedRequirements].map((record) => [record.id, record])
  );
  const interrupted = facts.open.records.filter((record) => record.status === 'in-progress');

  // Blockers are reported and never offered as candidates. Each one means that the session is not
  // in a position to take new work. Listing a blocker among the candidates would invite exactly
  // the choice it exists to prevent.
  const blockers = [];
  for (const record of interrupted) {
    blockers.push(
      `${record.id} is 'in-progress' — a session ended with it unfinished. Resume it, or say why ` +
        `not. Note: ${record.note ?? '(none, which should not be possible)'}`
    );
  }
  if (facts.checkout.open) {
    blockers.push(
      `${store.workPath} holds an unfinished checkout (${facts.checkout.ids.join(', ') || 'no ids'}) — ` +
        `its edits exist nowhere else. Run 'jtrek checkin' before taking anything new.`
    );
  }
  if (!facts.registryMdMatches) {
    blockers.push(`${store.registryMdPath} does not match the store — run 'jtrek build'.`);
  }
  for (const problem of instructionProblems(store)) blockers.push(problem);
  const unresolved = guardCommandProblem(store);
  if (unresolved !== null) blockers.push(unresolved);

  // Rank 1 is the records the hand-off names. The store decides what a record's status is. A
  // hand-off that points at a record the store has closed is therefore out of date, and it is not
  // treated as a second opinion.
  const conflicts = [];
  const fromHandoff = [];
  for (const id of handoff.ids) {
    const open = byId.get(id);
    if (!open) {
      conflicts.push(
        `The hand-off names ${id} under 'Start here', but the store has it closed or does not ` +
          `have it at all. The store is authoritative for status — the hand-off is stale here.`
      );
      continue;
    }
    if (open.status === 'in-progress') continue; // It is already reported as a blocker.
    if (!isCandidate(open)) {
      conflicts.push(
        `The hand-off names ${id} under 'Start here', but it is a '${open.type}' at ` +
          `'${open.status}', which is not work to pick up.`
      );
      continue;
    }
    fromHandoff.push(open);
  }
  if (handoff.present && !handoff.section) {
    conflicts.push(
      `${t.handoffFile} has no 'Start here' section, so it names nothing as the next thing to do. ` +
        `Only the store ranked the candidates below.`
    );
  }
  // A section written as prose or as a bullet list is deliberately not read. Scanning it would mix
  // work with background again, which is what the table exists to prevent.
  if (handoff.section && !handoff.table) {
    conflicts.push(
      `${t.handoffFile} has a 'Start here' section with no table, so it names nothing as the next ` +
        `thing to do. The first column is what a session picks up; see the closing procedure.`
    );
  }
  if (!handoff.present) {
    conflicts.push(`${t.handoffFile} does not exist — no source says what a person decided to do next.`);
  }

  // Rank 2 is every other open record, most recently revised first. The revision date is a fact
  // the store holds, and the most recently revised record is likely to be what the last session
  // was working on. Records with the same date are ordered by id, so that two runs over an
  // unchanged store always agree.
  const named = new Set(fromHandoff.map((record) => record.id));
  const fromStore = facts.open.records
    .filter((record) => isCandidate(record) && !named.has(record.id))
    .sort((a, b) => (a.ts === b.ts ? compareIds(a.id, b.id) : b.ts.localeCompare(a.ts)));

  const describe = (record, sources) => {
    const section = record.plan ? sections.get(record.plan) : null;
    if (record.plan && !section) {
      conflicts.push(
        `${record.id} is filed under plan section '${record.plan}', which ${t.planDoc} has no ` +
          `heading for. ` +
          (NUMBERED.test(record.plan)
            ? `Plan sections are named by slug rather than by number, and 'jtrek migrate ` +
              `--plan-slugs' renames them.`
            : `Either the section was renamed or the record's 'plan' value is wrong.`)
      );
    }
    return {
      id: record.id,
      type: record.type,
      title: record.title,
      plan: record.plan,
      planTitle: section?.title ?? null,
      planPurpose: section?.purpose ?? null,
      detail_ref: record.detail_ref,
      note: record.note,
      sources,
    };
  };

  const ranked = [
    ...fromHandoff.map((record) => describe(record, ['handoff', 'store'])),
    ...fromStore.map((record) => describe(record, ['store'])),
  ];
  const candidates = limit === 0 ? ranked : ranked.slice(0, limit);

  return {
    store: store.dir,
    sources: {
      store: { records: facts.records, open: facts.open.total },
      handoff: { path: t.handoffFile, ...handoff },
      plan: { path: t.planDoc, sections: sections.size },
    },
    blockers,
    interrupted,
    needsAPerson: facts.needsAPerson,
    deferred: facts.deferred,
    candidates,
    truncated: ranked.length - candidates.length,
    conflicts,
    recommendation: recommend(candidates, blockers),
    git: facts.git,
  };
}

function readIfPresent(filePath) {
  return fs.existsSync(filePath) ? readText(filePath) : null;
}

/**
 * Returns the top candidate and the reason it is at the top.
 *
 * A recommendation given without its reason would be a guess that looks authoritative. The reason
 * is always the ranking rule that put the record first, and never a judgement about the work
 * itself. jtrek cannot understand what a record says, and it must not pretend to.
 */
export function recommend(candidates, blockers) {
  if (blockers.length > 0) {
    return {
      id: null,
      reason: `Clear the ${blockers.length} blocker(s) above first — none of them is a choice.`,
    };
  }
  if (candidates.length === 0) return { id: null, reason: 'Nothing is open. Ask the owner.' };

  const top = candidates[0];
  return {
    id: top.id,
    reason: top.sources.includes('handoff')
      ? 'The hand-off names it first under \'Start here\', and the store agrees it is open.'
      : 'Nothing names a next step, so this is the most recently revised open record — the thread the last session was pulling.',
  };
}

function format(facts) {
  const out = [];
  const bullet = (items, empty) =>
    items.length === 0 ? [`  ${empty}`] : items.map((item) => `  - ${item}`);

  out.push('# Opening evidence', '');
  out.push(`Store: ${facts.store}`, '');

  out.push('## Sources', '');
  out.push(`  store           ${facts.sources.store.records} record(s), ${facts.sources.store.open} open`);
  out.push(
    `  hand-off        ${
      !facts.sources.handoff.present
        ? 'missing'
        : !facts.sources.handoff.section
          ? "read — no 'Start here' section"
          : !facts.sources.handoff.table
            ? "read — 'Start here' has no table, so it names nothing"
            : `read — names ${facts.sources.handoff.ids.length} record(s) under 'Start here'`
    }`
  );
  out.push(`  plan            ${facts.sources.plan.sections} section(s)`);
  // The git state is printed because it is the actual state of the environment. R-0047 was raised
  // about a hand-off that described a branch ten commits ahead in a repository that did not exist.
  // The hand-off is authoritative for the state of the environment only until git disagrees with
  // it.
  out.push(
    `  git             ${
      !facts.git.available
        ? 'not a git repository'
        : `${facts.git.branch ?? 'detached'}, ${
            facts.git.ahead === null ? 'no upstream' : `${facts.git.ahead} ahead / ${facts.git.behind} behind`
          }, ${facts.git.uncommitted ?? '?'} uncommitted`
    }`
  );
  out.push(`  parked          ${facts.deferred.length} record(s) — 'jtrek handoff' lists the conditions`);
  out.push('');

  out.push('## Blockers — not candidates, deal with them first', '');
  out.push(...bullet(facts.blockers, 'Nothing blocks a start.'));
  out.push('');

  out.push('## Needs a person (open questions)', '');
  out.push(
    ...bullet(
      facts.needsAPerson.map((record) => `${record.id}  ${record.title}`),
      'Nothing waiting on the owner.'
    )
  );
  out.push('');

  out.push('## Candidates, ranked', '');
  out.push('  1. named by the hand-off under \'Start here\'   2. open, most recently revised first', '');
  if (facts.candidates.length === 0) {
    out.push('  Nothing open to pick up.');
  } else {
    for (const [index, candidate] of facts.candidates.entries()) {
      out.push(`  ${index + 1}. ${candidate.id}  ${candidate.title}`);
      out.push(`       source: ${candidate.sources.join(' + ')}   type: ${candidate.type}`);
      if (candidate.plan) {
        const purpose = candidate.planPurpose ? ` — ${truncate(candidate.planPurpose, 90)}` : '';
        out.push(`       plan:   ${candidate.plan}${candidate.planTitle ? ` — ${candidate.planTitle}` : ''}${purpose}`);
      }
      if (candidate.detail_ref) out.push(`       prose:  ${candidate.detail_ref}`);
      out.push('');
    }
    if (facts.truncated > 0) {
      out.push(`  ${facts.truncated} more open record(s) not shown — pass --limit 0 for all.`, '');
    }
  }

  out.push('## Where the sources disagree', '');
  out.push(...bullet(facts.conflicts, 'The store, the hand-off and the plan agree.'));
  out.push('');

  out.push('## Recommendation', '');
  out.push(
    facts.recommendation.id
      ? `  ${facts.recommendation.id} — ${facts.recommendation.reason}`
      : `  ${facts.recommendation.reason}`
  );
  out.push('', '  Selecting none of these is a valid answer; the owner decides.');
  out.push("  Nothing has been taken. Run 'jtrek checkout --id <id>' once they have chosen.");

  return out.join('\n');
}

function truncate(text, width) {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const facts = collect(store, { limit: args.limit });

  process.stdout.write(args.json ? `${JSON.stringify(facts, null, 2)}\n` : `${format(facts)}\n`);

  // Blockers are reported on stderr as well as in the output. The output is long, and a blocker
  // that is read late tends to be worked around instead of dealt with. The exit code stays 0, for
  // the reason given at the top of this file.
  if (facts.blockers.length > 0) {
    logger.warn(`${facts.blockers.length} blocker(s) — none of them is a candidate.`);
  }
  return 0;
}
