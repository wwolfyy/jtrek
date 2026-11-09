/**
 * src/dashboard.js computes what the dashboard tab of `jtrek view` shows: the store as a whole,
 * rather than one record at a time (`R-000142`).
 *
 * This module only computes. It reads no file and draws nothing. `src/commands/view.js` reads the
 * records and the plan document and serves what this module returns on `/api/dashboard`, and the
 * page draws it in the browser. Keeping the figures here means they can be tested without a
 * browser, which the page's own script cannot be.
 *
 * The dashboard takes over what `registry.md` shows, so that `R-000375` can retire that file: the
 * summary by type and status, the open work, the deferred records with their notes, the records
 * split into others, and the requirements in force by feature. It also shows each plan section's
 * progress, computed by `planProgress` in `src/progress.js`, the same function `jtrek plan
 * progress` calls, so that the page and the command cannot disagree.
 */

import { TYPES, STATUSES } from './commands/build.js';
import { planProgress, requirementCount } from './progress.js';
import { compareIds } from './store.js';

/** The fields of a record that a list on the dashboard shows. The page opens the rest by id. */
function summary(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    title: record.title,
    plan: record.plan,
  };
}

/**
 * A question is a decision the owner owes, and a requirement is a statement of what the product
 * does. Neither is work a session picks up, so the work lists leave both out (`R-000381`).
 */
const isWork = (record) => record.type !== 'question' && record.type !== 'requirement';

/**
 * Returns each feature's requirements counted as proposed, agreed and in force, with the statement
 * of every requirement in force. Features are ordered by name, and statements by id.
 */
function features(records) {
  const byFeature = new Map();
  for (const record of records) {
    const count = requirementCount(record);
    if (count === null) continue;
    if (!byFeature.has(record.feature)) {
      byFeature.set(record.feature, {
        feature: record.feature,
        proposed: 0,
        agreed: 0,
        inForce: 0,
        statements: [],
      });
    }
    const entry = byFeature.get(record.feature);
    entry[count] += 1;
    if (count === 'inForce') {
      entry.statements.push({ id: record.id, title: record.title, statement: record.statement });
    }
  }
  return [...byFeature.values()].sort((a, b) => a.feature.localeCompare(b.feature));
}

/**
 * Returns the number of records of each type at each status, with every combination present so
 * that the page can draw a full table.
 *
 * The rows and columns follow the order `jtrek build` uses for `registry.md`'s summary. A type or
 * status the store holds that those lists do not name is added at the end, rather than dropped,
 * because a table that leaves records out stops adding up without saying so.
 */
function counts(records) {
  const extra = (known, field) =>
    [...new Set(records.map((record) => record[field]))].filter((value) => !known.includes(value));
  const types = [...TYPES, ...extra(TYPES, 'type')];
  const statuses = [...STATUSES, ...extra(STATUSES, 'status')];

  const byTypeAndStatus = Object.fromEntries(
    types.map((type) => [type, Object.fromEntries(statuses.map((status) => [status, 0]))])
  );
  for (const record of records) byTypeAndStatus[record.type][record.status] += 1;
  return { types, statuses, byTypeAndStatus, total: records.length };
}

/**
 * Returns each record that others were split from, with those records and how many of them are
 * done. A parent the store does not hold is still listed, by id alone, so that its children are
 * not hidden; the `references` group of `jtrek check` is what reports it.
 */
function splits(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map();
  for (const record of records) {
    if (!record.split_from) continue;
    children.set(record.split_from, [...(children.get(record.split_from) ?? []), record]);
  }
  return [...children.keys()].sort(compareIds).map((parentId) => {
    const list = children.get(parentId).sort((a, b) => compareIds(a.id, b.id));
    return {
      parent: byId.has(parentId) ? summary(byId.get(parentId)) : { id: parentId },
      children: list.map(summary),
      done: list.filter((record) => record.status === 'done').length,
    };
  });
}

/**
 * Computes the whole dashboard.
 *
 * `records` holds the current revision of every record. `planText` is the plan document, or null
 * when there is none, and `planPath` is where it was looked for. Without a plan document there is
 * no progress to show, so `plan` is null and `planMissing` says why, and everything else is shown
 * as usual (`R-000378`).
 */
export function dashboard(records, planText, planPath) {
  const byId = [...records].sort((a, b) => compareIds(a.id, b.id));
  return {
    plan: planText === null ? null : planProgress(planText, records),
    planMissing:
      planText === null
        ? `There is no plan document at ${planPath}, so no section's progress can be shown.`
        : null,
    features: features(byId),
    work: {
      open: byId.filter((r) => isWork(r) && r.status === 'open').map(summary),
      inProgress: byId.filter((r) => isWork(r) && r.status === 'in-progress').map(summary),
    },
    questions: byId.filter((r) => r.type === 'question' && r.status === 'open').map(summary),
    deferred: byId
      .filter((r) => r.status === 'deferred')
      .map((r) => ({ ...summary(r), note: r.note })),
    counts: counts(byId),
    splits: splits(byId),
  };
}
