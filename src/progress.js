/**
 * src/progress.js computes each plan section's progress from the records that name it.
 *
 * The plan document holds no progress, by design. Whether a section is untouched, in flight or
 * finished is derived from the records whose `plan` value names it. `jtrek plan progress` prints
 * what this module computes, and the dashboard `R-000142` plans is meant to show the same figures.
 * Both are meant to call this one function, so that the two cannot disagree (`R-000187`).
 *
 * The computation needs the plan document as well as the records, which is why it is written here
 * rather than as a view in `schema.sql`. A query over the records alone returns nothing both for a
 * section that has no records and for a section whose records are all closed. Only the list of
 * sections in the plan document can tell those two apart, and the database never sees that
 * document. `R-0015` identified that gap.
 *
 * ## What each state means
 *
 * A section is in exactly one of four states. The owner settled the rules on 2026-09-27, and
 * `R-000187` records them.
 *
 * - **empty**: no record names the section.
 * - **in progress**: at least one record that is not a requirement is still unfinished, which means
 *   that its status is `open`, `in-progress`, `planned` or `deferred`, or at least one requirement
 *   naming it is agreed but not yet in force. Planned and deferred work counts, because the section
 *   is not finished while any of it remains, even when nobody is working on it. An agreed
 *   requirement, at `planned`, counts because it waits for its test and the code that passes it,
 *   which is work a session does rather than a review (`R-000371`, `R-000386`).
 * - **awaiting review**: all of its other work is closed, and at least one requirement naming it is
 *   still proposed, meaning at `open`. It keeps the section from being finished, because `R-000181`
 *   makes a section's requirements part of its work. It is not counted as work in hand, because it
 *   waits for the owner's review rather than for a session, in the same way as `jtrek start`
 *   counts it apart from the candidates (`R-000368`).
 * - **finished**: every record naming the section is closed. Work is closed when it is `done` or
 *   `abandoned`, and a requirement is closed when it is in force, superseded or abandoned.
 */

import { planSections } from './plan.js';
import { isInForce } from './spec.js';

/** The four states a section can be in, in the order in which the rules above test them. */
export const STATES = ['empty', 'in progress', 'awaiting review', 'finished'];

const ACTIVE = new Set(['open', 'in-progress']);
const PARKED = new Set(['planned', 'deferred']);

/**
 * Returns which of the three requirement counts a requirement belongs in: `proposed`, `agreed` or
 * `inForce`. It returns null for a requirement that was superseded or abandoned, which is counted
 * in none of them, and for a record that is not a requirement.
 *
 * A requirement that has left `open` without reaching `done` or `abandoned` was agreed by the
 * owner. That is usually `planned`, but a session that stopped with one unfinished leaves it at
 * `in-progress`, and every such requirement still keeps its section from being finished. The
 * dashboard of `jtrek view` counts each feature's requirements with this same function, so that it
 * and `jtrek plan progress` cannot sort a requirement differently.
 */
export function requirementCount(record) {
  if (record.type !== 'requirement') return null;
  if (isInForce(record)) return 'inForce';
  if (record.outcome === 'superseded' || record.status === 'abandoned') return null;
  return record.status === 'open' ? 'proposed' : 'agreed';
}

/**
 * Returns the counts for one section's records, and the state those counts put it in.
 *
 * The work counts leave requirements out, and the requirement counts hold only requirements, so
 * that a reader can see which kind of record is keeping a section open. A requirement that was
 * superseded or abandoned is counted in neither of the requirement columns, but it still counts as
 * a record naming the section, so the section is not reported as empty.
 */
function sectionProgress(records) {
  const work = { active: 0, parked: 0, done: 0, abandoned: 0 };
  const requirements = { proposed: 0, agreed: 0, inForce: 0 };
  for (const record of records) {
    if (record.type === 'requirement') {
      const count = requirementCount(record);
      if (count !== null) requirements[count] += 1;
    } else if (ACTIVE.has(record.status)) work.active += 1;
    else if (PARKED.has(record.status)) work.parked += 1;
    else if (record.status === 'done') work.done += 1;
    else if (record.status === 'abandoned') work.abandoned += 1;
  }

  let state = 'finished';
  if (records.length === 0) state = 'empty';
  else if (work.active + work.parked + requirements.agreed > 0) state = 'in progress';
  else if (requirements.proposed > 0) state = 'awaiting review';

  return { state, records: records.length, work, requirements };
}

/**
 * Computes the progress of every section in a plan document.
 *
 * `text` is the plan document, and `records` holds the current revision of every record. The
 * sections are returned in the order in which the plan lists them. A `plan` value that names no
 * section is returned under `unknown` with the ids of the records carrying it, because dropping
 * those records would make a section look further along than it is. `jtrek plan check` is the
 * command that fails on such a value, and this function only reports it. `unfiled` counts the
 * records with no `plan` value, which is allowed.
 */
export function planProgress(text, records) {
  const sections = planSections(text);
  const bySection = new Map([...sections.keys()].map((slug) => [slug, []]));
  const unknown = new Map();
  let unfiled = 0;

  for (const record of records) {
    if (!record.plan) {
      unfiled += 1;
    } else if (bySection.has(record.plan)) {
      bySection.get(record.plan).push(record);
    } else {
      unknown.set(record.plan, [...(unknown.get(record.plan) ?? []), record.id]);
    }
  }

  return {
    sections: [...sections].map(([slug, { title }]) => ({
      slug,
      title,
      ...sectionProgress(bySection.get(slug)),
    })),
    unknown: [...unknown].map(([plan, ids]) => ({ plan, ids })),
    unfiled,
  };
}
