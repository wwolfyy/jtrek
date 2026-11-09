/**
 * src/commands/cross-review.js implements `jtrek cross-review`, which starts the cross-family reviewer of a
 * finished feature or plan section and prints the report it returns.
 *
 * The review procedure installed in the project has four stages, and the second, the cross-family
 * review, must be made by an agent from a different family of models from the one that wrote the code, because models of
 * one family tend to share blind spots (`R-000417`). A session cannot start such an agent from
 * inside its own harness, so this command starts another lab's command-line agent as a separate
 * process, read-only and without interaction (`R-000413`). The rule that the two families differ
 * is enforced here, in code, rather than by the wording of the procedure.
 *
 * The `cross_review` block of `jtrek.json` names the agent to start, the family of the model that
 * writes the project's code, the family of the reviewer's model and, optionally, the model to ask
 * for. The owner chose to record both families there rather than infer the writer's family from the
 * model a session runs on. A project that changes the model writing its code therefore changes the
 * setting too.
 *
 * This command gathers everything Part B of the review procedure asks the reviewer to read into one
 * instruction, and passes it on the agent's standard input. It first did so because it was not known
 * whether each agent's read-only mode lets the agent run `git` or `jtrek query` itself. The first
 * real review with agy showed that a refused command can end the review without a report, so the
 * instruction also names the few commands the reviewer may run, and explains how to read the store
 * with `jtrek query` and `jtrek history` (R-000567 to R-000569). The diff stays in the instruction,
 * because `git` is not among those commands. For a plan section, the instruction lists the changed
 * files instead of holding their diff, and the reviewer reads them itself.
 *
 * The command writes nothing. The reviewer's report goes to stdout, and everything else to stderr.
 *
 * Usage:
 *   jtrek cross-review --feature <slug> [--base <branch>]
 *   jtrek cross-review --section <slug> [--base <branch>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { PLAN_FILENAME, sectionSpans } from '../plan.js';
import { SUPPORTED_AGENTS, runReviewer } from '../reviewer.js';
import { fieldDescriptions } from '../schema-doc.js';
import { countsTowardsSection } from '../spec.js';
import { ID_ORDER, createDatabase, fromRow, openStore } from '../store.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/cross-review');

export const USAGE = `
Usage:
  jtrek cross-review --feature <slug> [--base <branch>]   review a finished feature's branch
  jtrek cross-review --section <slug> [--base <branch>]   review a finished plan section

Starts the reviewer that the 'cross_review' block of jtrek.json names, read-only and without
interaction, gives it Part B of the review procedure together with the requirements and the
change, and prints its report. --base is the branch the work merges into, and is main by default.
Writes nothing.
`.trim();

const FAMILY_SETTINGS = ['writer_family', 'reviewer_family'];

const REQUIRED_SETTINGS = ['agent', ...FAMILY_SETTINGS];

const DEFAULT_BASE = 'main';

// A diff of a whole feature can be large, and the default limit of `execFileSync` is one megabyte,
// beyond which it fails.
const MAX_OUTPUT = 256 * 1024 * 1024;

export function parseArgs(argv) {
  const args = { feature: null, section: null, base: DEFAULT_BASE, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--feature':
      case '--section':
      case '--base':
        // A value that begins with a dash is the next flag, given where the value was left out.
        // No slug or branch can begin with one, because git refuses such a branch name (R-000590).
        if (!value || value.startsWith('-')) throw new UsageError(`${flag} needs a value.\n\n${USAGE}`);
        args[flag.slice(2)] = value;
        i += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        return args;
      default:
        throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
    }
  }

  if ((args.feature === null) === (args.section === null)) {
    throw new UsageError(`Pass exactly one of --feature <slug> and --section <slug>.\n\n${USAGE}`);
  }
  return args;
}

/**
 * Returns the `cross_review` block of `jtrek.json`, after refusing one that cannot start a reviewer of
 * another family. Each refusal is thrown before any reviewer is started.
 */
function reviewSettings(store) {
  const settings = store.config?.cross_review;
  if (!settings) {
    throw new Error(
      `jtrek.json has no 'cross_review' block, so no reviewer is named. Add one, such as ` +
        `"cross_review": { "agent": "codex", "writer_family": "anthropic", "reviewer_family": "openai" }.`
    );
  }
  const missing = REQUIRED_SETTINGS.filter((key) => !settings[key]);
  if (missing.length > 0) {
    throw new Error(`The 'cross_review' block in jtrek.json lacks ${missing.join(', ')}.`);
  }
  if (!SUPPORTED_AGENTS.includes(settings.agent)) {
    throw new Error(
      `The 'cross_review' block in jtrek.json names the agent '${settings.agent}', which jtrek cannot ` +
        `start. The supported agents are ${SUPPORTED_AGENTS.join(', ')}.`
    );
  }
  // A family that is not text, or is only spaces, names no family, so the two could not be told
  // apart (R-000591). Spaces at either end are ignored when the two are compared (R-000466).
  const unnamed = FAMILY_SETTINGS.filter(
    (key) => typeof settings[key] !== 'string' || settings[key].trim() === ''
  );
  if (unnamed.length > 0) {
    throw new Error(
      `The 'cross_review' block in jtrek.json gives ${unnamed.join(' and ')} a value that names no ` +
        `family. Each must be text, such as "anthropic" or "openai".`
    );
  }
  if (settings.writer_family.trim().toLowerCase() === settings.reviewer_family.trim().toLowerCase()) {
    throw new Error(
      `The 'cross_review' block in jtrek.json places the reviewer in the writer's own family ` +
        `'${settings.writer_family}'. The reviewer must come from a different family of models, ` +
        `because models of one family tend to share blind spots.`
    );
  }
  return settings;
}

/** Returns Part B of the review procedure installed in the project, from its heading to the next. */
function partB(store) {
  const docPath = path.join(store.dir, 'docs', 'reviewing.md');
  const text = readText(docPath);
  const start = text.search(/^## Part B\b/m);
  if (start === -1) {
    throw new Error(`${docPath} has no Part B. Run 'jtrek agent install' to restore it.`);
  }
  const next = text.slice(start + 1).search(/^## /m);
  return text.slice(start, next === -1 ? text.length : start + 1 + next).trim();
}

/**
 * The commands the reviewer may run (R-000569). None of them can write a file. They are the commands
 * the owner allowed in the settings of the agent agy on 2026-10-25, because agy ends the whole review
 * with an empty response when it refuses a command, as `R-000463` records. Codex's read-only sandbox
 * lets all of them run, because none of them writes.
 */
const ALLOWED_COMMANDS = ['jtrek query', 'jtrek history', 'ls', 'cat', 'grep'];

/**
 * Returns one line per column a `jtrek query` predicate can name, with the meaning the installed
 * schema document gives it (R-000568). The columns are read from the schema that `jtrek query`
 * runs against, so the list cannot name a column the query would refuse. A column the document does
 * not describe is refused rather than listed without a meaning, because the installed document is
 * then out of date.
 */
function columnLines(store) {
  const docPath = path.join(store.dir, 'docs', 'schema.md');
  const descriptions = fieldDescriptions(readText(docPath));
  const db = createDatabase({ schemaPath: store.schemaPath });
  let columns;
  try {
    columns = db.prepare('PRAGMA table_info(current_records)').all().map((column) => column.name);
  } finally {
    db.close();
  }
  return columns.map((name) => {
    if (!descriptions.has(name)) {
      throw new Error(`${docPath} does not describe the column '${name}'. Run 'jtrek agent install' to restore it.`);
    }
    return `- \`${name}\` — ${descriptions.get(name)}`;
  });
}

/**
 * Returns the part of the instruction that says how to read the store (R-000567), which columns a
 * query can name (R-000568) and which commands the reviewer may run (R-000569).
 */
function storeAndCommands(store) {
  return [
    '## Reading the store, and the commands allowed',
    `You may run only these commands: ${ALLOWED_COMMANDS.map((command) => `\`${command}\``).join(', ')}. ` +
      'Running any other command can end the review without a report, because the command is refused ' +
      'and the refusal can end your turn.',
    'Read the records of the store with the three commands below. `jtrek query` and `jtrek history` ' +
      'read the store and write nothing. Do not read `registry.ndjson` itself, because it also holds ' +
      'every earlier revision of each record.',
    [
      '- `jtrek query --id <id>` prints the current revision of the record `<id>` as JSON. `--id` can be given more than once.',
      '- `jtrek query --query "<SQL predicate>"` prints the current revision of every record that matches the predicate, ' +
        'as JSON. The predicate is placed after `WHERE` in a query of the current revision of every record, as in ' +
        '`jtrek query --query "type = \'requirement\' AND status = \'done\'"`.',
      '- `jtrek history --id <id>` prints every revision of the record `<id>`, oldest first, as JSON.',
    ].join('\n'),
    'A predicate can name these columns. `supersedes` and `files` hold JSON arrays, which SQLite reads ' +
      'with `json_each`, as in `EXISTS (SELECT 1 FROM json_each(supersedes) WHERE value = \'R-0142\')` and ' +
      '`EXISTS (SELECT 1 FROM json_each(files) WHERE value = \'src/main.js\')`. `related` holds a JSON object ' +
      'that maps each kind of relation to an array of ids. `json_each(related)` returns those arrays rather ' +
      'than the ids inside them, so a predicate written with it matches nothing. Read `related` with ' +
      '`json_tree` to find an id under any kind, as in ' +
      '`EXISTS (SELECT 1 FROM json_tree(related) WHERE value = \'R-0142\')`, or with a path that names one ' +
      'kind, as in `EXISTS (SELECT 1 FROM json_each(related, \'$.implements\') WHERE value = \'R-0142\')`.',
    columnLines(store).join('\n'),
  ].join('\n\n');
}

/**
 * Returns the current revision of every requirement whose `column` holds `value`, except one that
 * was abandoned or superseded. Such a requirement no longer describes the product, so the reviewer
 * is not asked to judge the code against it, and a section does not look for the merge of a feature
 * that only such requirements tie to it (R-000474, R-000476, R-000593). The test is the one the spec
 * uses to tie a feature to its section. The value comes from the command line, so it is passed to
 * SQLite as a parameter rather than written into the query. `column` is always one of this module's
 * own constants.
 */
function requirementsWhere(store, column, value) {
  const { db } = openStore({ registryPath: store.registryPath, schemaPath: store.schemaPath });
  try {
    return db
      .prepare(
        `SELECT * FROM current_records WHERE type = 'requirement' AND ${column} = ? ORDER BY ${ID_ORDER}`
      )
      .all(value)
      .map(fromRow)
      .filter(countsTowardsSection);
  } finally {
    db.close();
  }
}

function requirementList(requirements) {
  if (requirements.length === 0) return 'No requirement names it.';
  return requirements.map((r) => `- ${r.id} (${r.status}): ${r.statement}`).join('\n');
}

// Every caller puts `--end-of-options` before the values that come from the command line. Without
// it, git would read such a value as one of its own options when it began with a dash, as a base
// branch named `--output=<file>` would.
function git(store, args) {
  return execFileSync('git', args, {
    cwd: store.projectRoot,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The files of the store that are left out of the change handed to the reviewer, relative to the
 * store's directory (R-000475, R-000477). The first four record the work, and the reviewer is given
 * the requirements directly. The `docs` directory holds documents that `jtrek agent install`
 * generates. The plan, the spec, the architecture document and the coding standards stay in the
 * change, because Part B asks the reviewer to judge whether the documents still describe the code.
 */
const LEFT_OUT = ['registry.ndjson', 'registry.md', 'records/', 'jtrek_handoff.md', 'docs/'];

/** Returns the left-out files as paths relative to the project root, with `/` as the separator. */
function leftOutPaths(store) {
  const storeDir = path.relative(store.projectRoot, store.dir).split(path.sep).join('/');
  return LEFT_OUT.map((file) => (storeDir ? `${storeDir}/${file}` : file));
}

/** Returns the pathspecs that restrict a git command to everything except the left-out files. */
function leftOutPathspecs(store) {
  return ['--', '.', ...leftOutPaths(store).map((file) => `:(exclude)${file.replace(/\/$/, '')}`)];
}

/** Returns the sentence that tells the reviewer which files were left out, on a single line. */
function leftOutNote(store) {
  const files = leftOutPaths(store).map((file) => `\`${file}\``);
  return (
    `The store's files ${files.slice(0, -1).join(', ')} and ${files.at(-1)} were left out of the ` +
    'change on purpose, because they record the work or are generated, and the requirements are ' +
    'given above. Do not report their absence as missing work.'
  );
}

function featureInstruction(store, slug, base) {
  const range = `${base}...feature/${slug}`;
  const diff = git(store, ['diff', '--end-of-options', range, ...leftOutPathspecs(store)]);
  return [
    `# Cross-family review of the feature \`${slug}\``,
    'Follow the procedure below. The requirements and the change it asks you to read are given after it.',
    partB(store),
    storeAndCommands(store),
    `## The requirements of the feature \`${slug}\``,
    requirementList(requirementsWhere(store, 'feature', slug)),
    '## The change',
    leftOutNote(store),
    `Everything after this line is the output of \`git diff ${range}\` without those files.`,
    diff,
  ].join('\n\n');
}

/** Returns the plan section's heading and text, or throws when the plan has no such section. */
function sectionText(store, slug) {
  const planPath = path.join(store.dir, PLAN_FILENAME);
  const text = fs.existsSync(planPath) ? readText(planPath) : null;
  const span = sectionSpans(text).find((section) => section.slug === slug);
  if (!span) throw new Error(`The plan at ${planPath} has no section '${slug}'.`);
  return text.slice(span.start, span.end).trim();
}

/**
 * Returns every file changed by a merge into `base` of one of the given feature branches, together
 * with the branches whose merge was found.
 *
 * A merge is recognised by the subject git writes for it, "Merge branch 'feature/<slug>'", which
 * is the only place a merge commit names the branch it merged once that branch is deleted. A merge
 * whose subject was rewritten, or one made through a GitHub pull request, is therefore not found.
 * The caller reports each branch missing from `found`, so that a partial list is never silent
 * (R-000495).
 */
function mergedFiles(store, base, branches) {
  const merges = git(store, ['log', '--first-parent', '--merges', '--format=%H %s', '--end-of-options', base]);
  const hashes = [];
  const found = new Set();
  for (const line of merges.split('\n').filter(Boolean)) {
    const [hash, ...subject] = line.split(' ');
    const merged = subject.join(' ').match(/^Merge branch '([^']+)'/)?.[1];
    if (!branches.has(merged)) continue;
    found.add(merged);
    hashes.push(hash);
  }
  if (hashes.length === 0) return { files: [], found };

  // One `git log` lists the files each merge changed against its first parent, which is what a
  // `git diff` of the merge against its first parent lists, without starting git once per merge.
  const changed = git(store, [
    'log',
    '--no-walk=unsorted',
    '--diff-merges=first-parent',
    '--name-only',
    '--format=',
    '--end-of-options',
    ...hashes,
    ...leftOutPathspecs(store),
  ]);
  const files = new Set(changed.split('\n').filter(Boolean));
  return { files: [...files].sort(), found };
}

function sectionInstruction(store, slug, base) {
  const requirements = requirementsWhere(store, 'plan', slug);
  const branches = new Set(
    requirements.filter((r) => r.feature).map((r) => `feature/${r.feature}`)
  );
  const { files, found } = mergedFiles(store, base, branches);
  const missing = [...branches].filter((branch) => !found.has(branch)).sort();
  const missingLines = missing.map(
    (branch) => `- The merge of \`${branch}\` into \`${base}\` was not found, so its files are not listed.`
  );
  for (const branch of missing) {
    logger.warn(
      `The merge of '${branch}' into '${base}' was not found, so the reviewer is not shown its files.`
    );
  }
  return [
    `# Cross-family review of the plan section \`${slug}\``,
    'Follow the procedure below. The section, its requirements and the files it changed are given after it.',
    partB(store),
    storeAndCommands(store),
    '## The plan section',
    sectionText(store, slug),
    `## The requirements of the plan section \`${slug}\``,
    requirementList(requirements),
    '## The change',
    leftOutNote(store),
    files.length === 0
      ? `No merge into \`${base}\` of a branch of this section's features was found, so no file is listed.`
      : `These files were changed by merges into \`${base}\` of the branches of this section's ` +
        `features. Read them yourself.\n\n${files.map((file) => `- ${file}`).join('\n')}`,
    ...(missing.length === 0
      ? []
      : [
          'The change above is incomplete. Say in the report which part of the section was not ' +
            `reviewed for this reason.\n\n${missingLines.join('\n')}`,
        ]),
  ].join('\n\n');
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const settings = reviewSettings(store);
  const instruction = args.feature
    ? featureInstruction(store, args.feature, args.base)
    : sectionInstruction(store, args.section, args.base);

  logger.info(`Starting the reviewer '${settings.agent}' (${settings.reviewer_family}).`);
  const report = runReviewer({
    agent: settings.agent,
    model: settings.model,
    instruction,
    cwd: store.projectRoot,
  });
  process.stdout.write(report);
  return 0;
}
