/**
 * src/commands/plan.js implements `jtrek plan`, the group of subcommands about the plan document
 * and the spec document that planning writes beside it.
 *
 * It has three subcommands, and none of them writes anything.
 *
 * `check` compares the `plan` value of every record with the sections of the plan document, and
 * fails when a value names no section or two sections share a slug (`R-0016`).
 *
 * `spec` prints the spec document as it would read if the open checkout were checked in. A planning
 * session writes a feature's requirements into `work.json` one at a time, and the owner reads each
 * feature in the spec before the next one starts (`R-000201`). `jtrek build` cannot show that
 * draft, because it renders from the store alone and the requirements are not in the store until
 * `jtrek checkin`. The draft is printed rather than written into the spec document, because the
 * committed document must equal the store for `jtrek build --check` to pass.
 *
 * `progress` prints each section of the plan with the counts of the records naming it, and the state
 * those counts put it in (`R-000187`). `src/progress.js` computes the figures and says what each
 * state means. It tells a section with no records from a finished one, which a query cannot. It
 * always exits 0, because it reports rather than gates, and `check` is the gate.
 *
 * The group once ran a planning store as well, through `start`, `take`, `status`, `apply` and
 * `discard`. A planning session drafted its records in that store, apart from the main store, and
 * the main store took no checkout or check-in until the store was applied or discarded. `R-000205`
 * retired all of it and decided that planning is a normal working session, which writes its records
 * through `jtrek checkout` and `jtrek checkin`. `R-000206` removed the code.
 *
 * Usage:
 *   jtrek plan check
 *   jtrek plan spec
 *   jtrek plan progress [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { currentRecords, openStore } from '../store.js';
import { PLAN_FILENAME, inspectPlan, planFindings, sectionSpans } from '../plan.js';
import { planProgress } from '../progress.js';
import { SPEC_FILENAME, isInForce, renderSpec } from '../spec.js';
import { readWorkFile } from './checkin.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/plan');

export const USAGE = `
Usage:
  jtrek plan check      every record's plan value names a section of the plan; reads only
  jtrek plan spec       print the spec with the requirements in work.json in place; reads only
  jtrek plan progress   each section's state and the counts of the records naming it; reads only
    --json               the same figures, for an agent
`.trim();

const SUBCOMMANDS = ['check', 'spec', 'progress'];

export function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  const args = { subcommand, help: false, json: false };

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    args.help = true;
    return args;
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    throw new UsageError(`Unknown subcommand '${subcommand}'.\n\n${USAGE}`);
  }
  for (const flag of rest) {
    if (flag === '--help' || flag === '-h') {
      args.help = true;
      return args;
    }
    if (flag === '--json' && subcommand === 'progress') {
      args.json = true;
      continue;
    }
    throw new UsageError(`'jtrek plan ${subcommand}' takes no '${flag}'.\n\n${USAGE}`);
  }
  return args;
}

/** Reads the store's current records. */
function readCurrent(store) {
  const { db } = openStore({
    registryPath: store.registryPath,
    schemaPath: store.schemaPath,
    allowMissing: true,
  });
  try {
    return currentRecords(db);
  } finally {
    db.close();
  }
}

/**
 * Compares every current record's `plan` value with the sections of the plan document (`R-0016`).
 *
 * `inspectPlan` in `src/plan.js` makes the comparison and explains what it reports. The `plan`
 * group of `jtrek check` calls the same function.
 */
export function checkPlan(store) {
  const planPath = path.join(store.dir, PLAN_FILENAME);
  const text = fs.existsSync(planPath) ? readText(planPath) : null;
  return planFindings(inspectPlan(text, readCurrent(store)), planPath);
}

/** Prints what `checkPlan` found, and returns the exit code: 1 when a problem was found, else 0. */
function reportPlanCheck(findings) {
  if (!findings.checked) {
    logger.info(`NOT CHECKED — ${findings.summary}`);
    return 0;
  }
  if (findings.problems.length === 0) {
    logger.info(`ok — ${findings.summary}`);
    return 0;
  }
  for (const problem of findings.problems) logger.error(problem);
  for (const remedy of findings.remedies) logger.error(`→ ${remedy}`);
  logger.error(`${findings.problems.length} problem(s) found between the records and the plan document.`);
  return 1;
}

/**
 * Returns the spec document with the requirements of the open checkout rendered in place.
 *
 * A record in `work.json` replaces the store's current revision of the same id, and a record the
 * store does not hold yet is added. The result is what `jtrek build` would write once the checkout
 * is checked in. A requirement in force whose feature names no heading is rendered nowhere, so each
 * one is reported, because a planning session that drafted it would otherwise not see that it is missing.
 */
export function draftSpec(store) {
  const specPath = path.join(store.dir, SPEC_FILENAME);
  if (!fs.existsSync(specPath)) {
    throw new Error(
      `There is no spec document at ${specPath}. 'jtrek agent install' creates it from its ` +
        `starting template.`
    );
  }
  const text = readText(specPath);

  const byId = new Map(readCurrent(store).map((record) => [record.id, record]));
  if (fs.existsSync(store.workPath)) {
    for (const record of readWorkFile(store.workPath)) byId.set(record.id, record);
  } else {
    logger.info(`There is no checkout at ${store.workPath}, so the spec shows the store alone.`);
  }

  const records = [...byId.values()];
  const features = new Set(sectionSpans(text).map((span) => span.slug));
  for (const record of records) {
    if (isInForce(record) && !features.has(record.feature)) {
      logger.warn(
        `${record.id} names feature '${record.feature}', which ${specPath} has no heading for, ` +
          `so it is not shown.`
      );
    }
  }
  return renderSpec(text, records);
}

/**
 * Returns the progress of every section of the plan document, as `planProgress` computes it, with
 * the plan document's path added.
 */
export function progress(store) {
  const planPath = path.join(store.dir, PLAN_FILENAME);
  if (!fs.existsSync(planPath)) {
    throw new Error(
      `There is no plan document at ${planPath}, so there are no sections to report on. ` +
        `'jtrek agent install' creates it from its starting template.`
    );
  }
  const text = readText(planPath);
  return { plan: planPath, ...planProgress(text, readCurrent(store)) };
}

/** The columns of the progress table, each with its heading and how to read it from a section. */
const PROGRESS_COLUMNS = [
  ['open', (section) => section.work.active],
  ['parked', (section) => section.work.parked],
  ['done', (section) => section.work.done],
  ['abandoned', (section) => section.work.abandoned],
  ['proposed', (section) => section.requirements.proposed],
  ['agreed', (section) => section.requirements.agreed],
  ['in force', (section) => section.requirements.inForce],
];

/** Formats what `progress` returned as the text a person reads. */
export function formatProgress(report) {
  const slugWidth = Math.max(7, ...report.sections.map((section) => section.slug.length));
  const stateWidth = Math.max(...['state', ...report.sections.map((s) => s.state)].map((t) => t.length));
  const row = (slug, state, cells) =>
    `  ${slug.padEnd(slugWidth)}  ${state.padEnd(stateWidth)}` +
    cells.map((cell, i) => String(cell).padStart(PROGRESS_COLUMNS[i][0].length + 2)).join('');

  const out = ['# Plan progress', '', `Plan: ${report.plan}`, ''];
  out.push(
    '  Work is every record that is not a requirement. "open" counts open and in-progress work,',
    '  and "parked" counts planned and deferred work. A requirement is "proposed" until the owner',
    '  agrees to it, then "agreed" until a passing test puts it in force.',
    ''
  );
  out.push(row('section', 'state', PROGRESS_COLUMNS.map(([heading]) => heading)));
  for (const section of report.sections) {
    out.push(row(section.slug, section.state, PROGRESS_COLUMNS.map(([, read]) => read(section))));
  }
  if (report.sections.length === 0) out.push('  The plan document has no sections.');

  if (report.unknown.length > 0) {
    out.push('', '## Plan values naming no section', '');
    for (const { plan, ids } of report.unknown) out.push(`  ${plan}: ${ids.join(', ')}`);
    out.push('', `  'jtrek plan check' fails on these. They are counted in no section above.`);
  }
  out.push('', `${report.unfiled} record(s) have no plan value, which is allowed.`);
  return `${out.join('\n')}\n`;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.subcommand === 'spec') {
    process.stdout.write(draftSpec(store));
    return 0;
  }
  if (args.subcommand === 'progress') {
    const report = progress(store);
    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatProgress(report));
    return 0;
  }
  return reportPlanCheck(checkPlan(store));
}
