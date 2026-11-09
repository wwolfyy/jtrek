/**
 * src/commands/agent.js implements `jtrek agent`, which teaches the agent working in a project how
 * to use the project's store.
 *
 * The instructions are generated, exactly as `registry.md` is. They describe the installed version
 * of jtrek, so a copy pasted in once becomes out of date as soon as the tool changes. The store
 * jtrek was extracted from shows this happening: its agent guide still tells sessions to run
 * script paths that no longer exist. The instructions are therefore rendered from `rules/` and
 * checked by a gate, in the same way as the registry:
 *
 *   registry.ndjson  → registry.md          → jtrek build --check
 *   rules/           → docs/rules.md        → jtrek agent --check
 *
 * The rules exist in one place, and instruction files point to that copy rather than repeating it.
 * A project may have `AGENTS.md`, `CLAUDE.md`, both of them, or one that is a symbolic link to the
 * other. If jtrek wrote the rules themselves into these files, it would have to choose between
 * leaving some agent without instructions and maintaining several copies that would drift apart.
 * A short pointer is not a copy, so every instruction file can carry one, and none of them can
 * contradict another. The pointer opens with an `@` import line, which agents that support imports
 * expand. Prose naming the same path follows it, for agents that do not.
 *
 * `--check` compares the content between the markers, not the marker line itself. The marker line
 * records the jtrek version that wrote it, for a person reading a diff. If the gate compared that
 * line too, it would fail on every release, even when nothing an agent reads had changed. People
 * would then learn to re-run the installer without looking, which defeats the purpose of a gate.
 *
 * `docs/AGENT-SUPPORT.md` records which parts are written for one agent only, and it should be read
 * before support for another vendor is added. In short, the block in `AGENTS.md` and the documents
 * beside the store work for any agent, while the skill files and the hook are specific to Claude
 * Code.
 *
 * Every install has a matching uninstall. jtrek writes into files that belong to the user, so it
 * must be able to take those edits out again. Otherwise adopting the tool would be a change that
 * nobody could undo. `uninstall` removes only what `install` wrote, and it never touches the store.
 * The registry and the records are the work itself, not the tooling around it.
 *
 * The plan document is the one exception to all of the above, and it is an exception on purpose.
 * Everything else this module writes is generated, so it is rewritten on every install and checked
 * by `--check`. The plan document holds prose that a person keeps accurate. It is therefore created
 * from a starting template when it is missing and never touched again. A reinstall does not
 * overwrite it, `--check` does not compare it, and `uninstall` does not remove it. It belongs in the
 * same category as the store, as part of the work rather than the tooling around it. The spec
 * document and the hand-off are treated the same way, for the same reason. `jtrek build` rewrites
 * the requirements listed in the spec, but this module never writes to the spec after creating it.
 *
 * Usage:
 *   jtrek agent install [--hooks] [--claude]   write the block and the documents, and optionally the hook
 *   jtrek agent install --user-hook            also write the hook into the user's own Claude Code settings
 *   jtrek agent --check                        fail when what was written has drifted
 *   jtrek agent uninstall [--dry-run]          remove everything install wrote
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { readText, withLineEndingsOf } from '../text.js';

const logger = createLogger('jtrek/agent');

export const USAGE = `
Usage:
  jtrek agent install [--claude] [--no-hook]  install or refresh the agent instructions
  jtrek agent --check                         verify the installed instructions are current
  jtrek agent uninstall [--dry-run]           remove everything install wrote

Options:
  --claude               write the session, planning and coding procedures as Claude Code skills, and
                         install a PreToolUse hook that refuses direct writes to
                         registry.ndjson. The choice is recorded in jtrek.json, so a later
                         install with no flags reproduces it rather than installing less.
  --no-hook              with --claude, write the skills and leave the hook out. The hook goes
                         in the project's committed .claude/settings.json and runs on every
                         file edit, so a project can take the procedures without it.
  --user-hook            with install, also write the guard hook into the user's own Claude Code
                         settings (~/.claude/settings.json, or $CLAUDE_CONFIG_DIR). Claude Code
                         reads a project's .claude/ only in a session started in that directory,
                         so without this the guard does not run in a session started above the
                         project. The user-level hook runs in every session on this machine and
                         does nothing where there is no store. With uninstall, remove it again.
  --hooks                the old name for --claude, kept working and warned about
  --instructions <path>  write the pointer into this file only. Without it, every instruction
                         file present gets one — AGENTS.md, CLAUDE.md, or both — and a symlink
                         between them counts as one file. An 'instructions' key in jtrek.json
                         does the same thing permanently.
  --dry-run              with uninstall, list what would be removed and remove nothing

Install also removes what jtrack, this tool's earlier name, installed into the project, and --check
fails while any of it remains. The user's own settings are left alone, because another project on
the machine may still use jtrack.

Uninstall never touches the store — the registry, the records, the policy and the plan document
are left alone.
`.trim();

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const RULES_DIR = path.join(PACKAGE_ROOT, 'rules');

export const BEGIN = '<!-- jtrek:begin';
export const END = '<!-- jtrek:end -->';

/**
 * The command string that identifies jtrek's hook in a settings file, so that the hook can be
 * found again to replace or remove it.
 */
export const GUARD_COMMAND = 'jtrek guard';

/**
 * The command the `PostToolUse` hook runs, which tells a session when it crosses the soft or hard
 * threshold set in `jtrek.json` (`R-000370`). `src/commands/threshold.js` explains how it measures
 * the context in use.
 */
export const THRESHOLD_COMMAND = 'jtrek threshold';

/**
 * What jtrack, the tool's earlier name, installed into a project. `jtrek migrate --from-jtrack`
 * moves a project's store but leaves these in place, and an agent there would read instructions to
 * run a command that no longer applies (`R-000641`). `install` removes them, and `--check` fails
 * while they are there.
 *
 * The skills are named one by one rather than matched by a pattern, because a pattern would also
 * remove a skill the project wrote itself under a similar name. These nine are the only ones any
 * jtrack build shipped. The hook pattern requires a word boundary after the command, so that a
 * command such as `jtrack guardian`, which is not jtrack's, is left alone.
 */
const FORMER_MARKERS = { begin: '<!-- jtrack:begin', end: '<!-- jtrack:end -->' };
const FORMER_HOOK_COMMAND = /\bjtrack (guard|threshold)\b/;
const FORMER_SKILLS = [
  'jtrack-code',
  'jtrack-handoff',
  'jtrack-plan',
  'jtrack-review',
  'jtrack-review-arbitrate',
  'jtrack-review-cross',
  'jtrack-review-refactor',
  'jtrack-review-report',
  'jtrack-start',
];

export function parseArgs(argv) {
  const args = {
    install: false,
    check: false,
    uninstall: false,
    claude: false,
    noHook: false,
    userHook: false,
    hooksAlias: false,
    dryRun: false,
    instructions: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === 'install') args.install = true;
    else if (flag === 'uninstall') args.uninstall = true;
    else if (flag === '--check') args.check = true;
    else if (flag === '--hooks') {
      args.claude = true;
      args.hooksAlias = true;
    } else if (flag === '--claude') args.claude = true;
    else if (flag === '--no-hook') args.noHook = true;
    else if (flag === '--user-hook') args.userHook = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--instructions') {
      if (!argv[i + 1]) throw new UsageError('--instructions needs a path, e.g. --instructions CLAUDE.md');
      args.instructions = argv[i + 1];
      i += 1;
    } else if (flag === '--help' || flag === '-h') return { ...args, help: true };
    else throw new UsageError(`Unknown argument '${flag}'.\n\n${USAGE}`);
  }

  // `--no-hook` narrows `--claude` and means nothing on its own. A run that passes it alone has
  // asked for something the tool cannot do. Saying so is better than ignoring the flag, because an
  // ignored flag would amount to installing nothing and reporting success.
  if (args.noHook && !args.claude) {
    throw new UsageError(`--no-hook narrows --claude and does nothing by itself.\n\n${USAGE}`);
  }

  const verbs = [args.install, args.check, args.uninstall].filter(Boolean).length;
  if (verbs === 0) throw new UsageError(`Pass 'install', 'uninstall' or '--check'.\n\n${USAGE}`);
  if (verbs > 1) throw new UsageError(`Pass only one of 'install', 'uninstall' or '--check'.\n\n${USAGE}`);

  // `--check` compares what jtrek wrote into the project. The user-level settings file belongs to
  // one machine rather than to the project, so a check against it would pass on some machines and
  // fail on others.
  if (args.userHook && args.check) {
    throw new UsageError(`--user-hook goes with install or uninstall, not --check.\n\n${USAGE}`);
  }
  return args;
}

function version() {
  const packagePath = path.join(PACKAGE_ROOT, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

/**
 * Removes a YAML frontmatter block. Only the copy written as a Claude Code skill needs one.
 */
function withoutFrontmatter(text) {
  const match = text.match(/^---\n[\s\S]*?\n---\n+/);
  return match ? text.slice(match[0].length) : text;
}

/**
 * The instruction files jtrek knows how to write, in order of preference.
 *
 * `AGENTS.md` is a convention that several agents read, so it is the better default. `CLAUDE.md` is
 * Claude Code's own file. Neither can stand in for the other, and which one reaches the agent
 * depends on an arrangement that only the project knows about.
 */
export const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * Decides which instruction files receive the pointer.
 *
 * Every instruction file that exists receives one. That is safe, because a pointer is not a copy.
 * The rules live in exactly one generated document, so two files that point to it cannot disagree.
 * Neither of them holds anything that would need to be kept in step. An earlier design wrote the
 * rules themselves into one chosen file. That forced a choice between leaving an agent without
 * instructions and maintaining two copies that would drift apart. Pointing to one document removes
 * the choice altogether, rather than managing it.
 *
 * Two names linked to one file must still be written only once. A project may make `CLAUDE.md` a
 * symbolic link to `AGENTS.md`, or the reverse. In both cases there is one real file with two
 * names, so the candidate files are first reduced to one per resolved path. `realpathSync` throws
 * an error on a broken link. That is treated as meaning the file cannot be used, rather than as a
 * fatal error.
 *
 * `--instructions <path>`, or an `instructions` key in `jtrek.json`, limits this to one file.
 */
export function resolveInstructions(store, override = null) {
  const root = store.projectRoot;

  if (override) {
    return { files: [path.resolve(root, override)], linked: [], explicit: true };
  }

  const seen = new Map();
  const linked = [];
  for (const name of INSTRUCTION_FILENAMES) {
    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) continue;
    let real;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    if (seen.has(real)) {
      linked.push({ name, sameFileAs: path.basename(seen.get(real)) });
      continue;
    }
    seen.set(real, candidate);
  }

  const files = [...seen.values()];
  // No instruction file exists yet, so the one that more agents read is created.
  if (files.length === 0) files.push(path.join(root, INSTRUCTION_FILENAMES[0]));

  return { files, linked, explicit: false };
}

/**
 * Returns where each generated document lives. Every path is derived from the project root, so
 * that the paths written into the instructions are paths a reader can follow.
 *
 * The groups below are not equivalent, and the separation between them must be preserved. The
 * portable group is written for every agent, and it is the only group jtrek depends on. The Claude
 * Code group is specific to one vendor. Supporting a second vendor means adding another group beside
 * it, rather than changing these. `docs/AGENT-SUPPORT.md` gives the fuller account.
 */
export function targets(store, { instructions = null } = {}) {
  const relativeStore = path.relative(store.projectRoot, store.dir) || '.';
  const resolved = resolveInstructions(store, instructions ?? store.config?.instructions ?? null);

  return {
    // The portable group, written for every agent.
    instructionFiles: resolved.files,
    instructions: resolved,
    rulesDoc: path.join(store.dir, 'docs', 'rules.md'),
    // This key is named after its file, like its neighbours. Until 2026-08-23 it was called
    // `handoffDoc`, which described its subject instead. That name read as a pair with
    // `handoffFile`, which is the hand-off this procedure maintains and the one file the gate must
    // not compare. R-0069 records the rename.
    closingDoc: path.join(store.dir, 'docs', 'closing-a-session.md'),
    openingDoc: path.join(store.dir, 'docs', 'opening-a-session.md'),
    planningDoc: path.join(store.dir, 'docs', 'planning.md'),
    codingDoc: path.join(store.dir, 'docs', 'writing-code.md'),
    reviewingDoc: path.join(store.dir, 'docs', 'reviewing.md'),
    reviewRefactorDoc: path.join(store.dir, 'docs', 'review-refactor.md'),
    reviewCrossDoc: path.join(store.dir, 'docs', 'review-cross.md'),
    reviewArbitrateDoc: path.join(store.dir, 'docs', 'review-arbitrate.md'),
    reviewReportDoc: path.join(store.dir, 'docs', 'review-report.md'),
    mapOverallDoc: path.join(store.dir, 'docs', 'map-overall.md'),
    mapWorkDoc: path.join(store.dir, 'docs', 'map-work.md'),
    mapReviewDoc: path.join(store.dir, 'docs', 'map-review.md'),
    sessionDoc: path.join(store.dir, 'docs', 'session.md'),
    glossaryDoc: path.join(store.dir, 'docs', 'glossary.md'),
    schemaDoc: path.join(store.dir, 'docs', 'schema.md'),

    // These four are created once from a template and then belong to the project. They sit beside
    // the registry rather than under `docs/`, because everything in `docs/` is generated and these
    // four are not.
    planDoc: path.join(store.dir, 'jtrek_plan.md'),
    specDoc: path.join(store.dir, 'jtrek_spec.md'),
    handoffFile: path.join(store.dir, 'jtrek_handoff.md'),
    codingStandardsFile: path.join(store.dir, 'coding-standards.md'),

    // Older builds generated these documents, and this one no longer writes them. The paths are
    // kept only so that `install` and `uninstall` can remove an old copy. The closing procedure used
    // to be written to `docs/handoff.md`, a name very close to that of the hand-off it maintains.
    // The three maps replaced a review map and a workflow map, which were written to the other two
    // paths (`R-000534`).
    legacyDocs: [
      path.join(store.dir, 'docs', 'handoff.md'),
      path.join(store.dir, 'docs', 'review-map.md'),
      path.join(store.dir, 'docs', 'workflow-map.md'),
    ],

    // The Claude Code group, written only on request.
    skillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-handoff', 'SKILL.md'),
    startSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-start', 'SKILL.md'),
    planSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-plan', 'SKILL.md'),
    codeSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-code', 'SKILL.md'),
    reviewSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-review', 'SKILL.md'),
    reviewRefactorSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-review-refactor', 'SKILL.md'),
    reviewCrossSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-review-cross', 'SKILL.md'),
    reviewArbitrateSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-review-arbitrate', 'SKILL.md'),
    reviewReportSkillFile: path.join(store.projectRoot, '.claude', 'skills', 'jtrek-review-report', 'SKILL.md'),
    settingsFile: path.join(store.projectRoot, '.claude', 'settings.json'),
    toolsRuleFile: path.join(store.projectRoot, '.claude', 'rules', 'jtrek.md'),

    relativeStore,
    relativeRulesDoc: path.join(relativeStore, 'docs', 'rules.md'),
    relativeHandoffDoc: path.join(relativeStore, 'docs', 'closing-a-session.md'),
    relativeOpeningDoc: path.join(relativeStore, 'docs', 'opening-a-session.md'),
    relativePlanningDoc: path.join(relativeStore, 'docs', 'planning.md'),
    relativeCodingDoc: path.join(relativeStore, 'docs', 'writing-code.md'),
    relativeReviewingDoc: path.join(relativeStore, 'docs', 'reviewing.md'),
    relativeReviewRefactorDoc: path.join(relativeStore, 'docs', 'review-refactor.md'),
    relativeReviewCrossDoc: path.join(relativeStore, 'docs', 'review-cross.md'),
    relativeReviewArbitrateDoc: path.join(relativeStore, 'docs', 'review-arbitrate.md'),
    relativeReviewReportDoc: path.join(relativeStore, 'docs', 'review-report.md'),
    relativeMapOverallDoc: path.join(relativeStore, 'docs', 'map-overall.md'),
    relativeMapWorkDoc: path.join(relativeStore, 'docs', 'map-work.md'),
    relativeMapReviewDoc: path.join(relativeStore, 'docs', 'map-review.md'),
    relativeSessionDoc: path.join(relativeStore, 'docs', 'session.md'),
    relativeGlossaryDoc: path.join(relativeStore, 'docs', 'glossary.md'),
    relativeSchemaDoc: path.join(relativeStore, 'docs', 'schema.md'),
    relativePlanDoc: path.join(relativeStore, 'jtrek_plan.md'),
    relativeSpecDoc: path.join(relativeStore, 'jtrek_spec.md'),
    // The architecture document is not installed, because the planning procedure writes it with
    // the owner and an empty template would give a review nothing to compare the code with
    // (`R-000407`). Only its path is needed, so that the installed documents can name it.
    relativeArchitectureDoc: path.join(relativeStore, 'jtrek_architecture.md'),
    relativeHandoffFile: path.join(relativeStore, 'jtrek_handoff.md'),
  };
}

/**
 * Inserts the shared passages into a template, before anything else is substituted.
 *
 * A statement that belongs in several documents is written once, in `rules/shared/`, and included
 * from there rather than typed into each document. `R-0099` measured what typing it into each
 * document had cost. The banner saying "this file is generated" appeared in three documents and had
 * already drifted: one said that `--check` fails "once" the two differ, where the others said "if".
 * The rule about prose files appeared in two documents, which differed in four separate clauses.
 * Nobody had noticed either drift, and nothing would have reported it.
 *
 * Only a statement whose copies are already nearly identical belongs in a shared passage. `R-0099`
 * found two more statements that look like candidates but are not. The copies stating that
 * `work.json` is gitignored, and the copies saying what `in-progress` means, are written at
 * different levels of detail: a table cell, a one-line warning and a glossary definition. One
 * wording cannot serve all of them, and forcing one on them would remove differences that serve a
 * purpose.
 *
 * The one thing a shared passage may vary by is `{{SOURCE}}`, which is replaced by the name of the
 * including file. That lets the banner name the template it was rendered from, without shared
 * passages needing arguments. This substitution runs before the path placeholders in
 * `renderTemplate`, so a shared passage may use those placeholders too.
 *
 * An unknown shared passage causes an error rather than being left in place. A `{{SHARED:…}}` token
 * written into an installed document would be a visible defect in every project that adopts jtrek.
 */
function renderShared(text, name) {
  return text.replace(/\{\{SHARED:([a-z0-9-]+)\}\}/g, (token, snippet) => {
    const file = path.join(RULES_DIR, 'shared', `${snippet}.md`);
    if (!fs.existsSync(file)) {
      throw new Error(`${name} includes ${token}, but rules/shared/${snippet}.md does not exist.`);
    }
    return readText(file).trim().replaceAll('{{SOURCE}}', `rules/${name}`);
  });
}

/** Substitutes the placeholders that make a template specific to this project. */
function renderTemplate(name, store) {
  const t = targets(store);
  return renderShared(readText(path.join(RULES_DIR, name)), name)
    .replaceAll('{{STORE}}', t.relativeStore)
    .replaceAll('{{RULES_DOC}}', t.relativeRulesDoc)
    .replaceAll('{{HANDOFF_DOC}}', t.relativeHandoffDoc)
    .replaceAll('{{OPENING_DOC}}', t.relativeOpeningDoc)
    .replaceAll('{{PLANNING_DOC}}', t.relativePlanningDoc)
    .replaceAll('{{CODING_DOC}}', t.relativeCodingDoc)
    .replaceAll('{{REVIEWING_DOC}}', t.relativeReviewingDoc)
    .replaceAll('{{REVIEW_REFACTOR_DOC}}', t.relativeReviewRefactorDoc)
    .replaceAll('{{REVIEW_CROSS_DOC}}', t.relativeReviewCrossDoc)
    .replaceAll('{{REVIEW_ARBITRATE_DOC}}', t.relativeReviewArbitrateDoc)
    .replaceAll('{{REVIEW_REPORT_DOC}}', t.relativeReviewReportDoc)
    .replaceAll('{{MAP_OVERALL_DOC}}', t.relativeMapOverallDoc)
    .replaceAll('{{MAP_WORK_DOC}}', t.relativeMapWorkDoc)
    .replaceAll('{{MAP_REVIEW_DOC}}', t.relativeMapReviewDoc)
    .replaceAll('{{SESSION_DOC}}', t.relativeSessionDoc)
    .replaceAll('{{GLOSSARY_DOC}}', t.relativeGlossaryDoc)
    .replaceAll('{{SCHEMA_DOC}}', t.relativeSchemaDoc)
    .replaceAll('{{PLAN_DOC}}', t.relativePlanDoc)
    .replaceAll('{{SPEC_DOC}}', t.relativeSpecDoc)
    .replaceAll('{{ARCHITECTURE_DOC}}', t.relativeArchitectureDoc)
    .replaceAll('{{HANDOFF_FILE}}', t.relativeHandoffFile)
    .replaceAll('{{THRESHOLDS}}', () => renderThresholds(store.config));
}

/**
 * Returns the sentence that states a project's two session thresholds, which `rules/session.md`
 * carries in place of `{{THRESHOLDS}}`.
 *
 * A threshold is a limit on how much of its context window a session may use, counted in tokens.
 * At the soft threshold a session takes on nothing new, and at the hard threshold it stops whatever
 * state its work is in. `R-0116` decided that a project writes both in `jtrek.json`, as
 * `"thresholds": {"soft": 250000, "hard": 300000}`, and that `jtrek agent install` writes them
 * into the session document, where the agent reads them as part of its instructions. `jtrek agent
 * --check` renders the document again from the current `jtrek.json`, so a threshold changed there
 * and not reinstalled fails that gate rather than drifting unnoticed. `R-000143` did the work.
 *
 * `jtrek.json` is optional, and a project may set no thresholds (`R-0019`). The owner chose on
 * 2026-09-27 that such a project's document says that none is set and names the key that sets
 * them. jtrek ships no default pair, because it has no basis for choosing a number for a project
 * it has never measured.
 *
 * A `thresholds` key that is present but malformed is an error rather than a document with no
 * thresholds. Rendering the "none set" sentence for it would hide a setting the project believes
 * it made.
 */
export function renderThresholds(config) {
  const thresholds = config?.thresholds;
  if (thresholds === undefined) {
    return (
      '📌 **This project has set no thresholds.** A project sets them in `jtrek.json` as ' +
      '`"thresholds": {"soft": …, "hard": …}`, in tokens of context in use.'
    );
  }

  const isCount = (value) => Number.isInteger(value) && value > 0;
  if (
    thresholds === null ||
    typeof thresholds !== 'object' ||
    !isCount(thresholds.soft) ||
    !isCount(thresholds.hard) ||
    thresholds.soft >= thresholds.hard
  ) {
    throw new Error(
      `'thresholds' in jtrek.json must hold 'soft' and 'hard', each a whole number of tokens ` +
        `greater than 0, with 'soft' below 'hard'. It holds ${JSON.stringify(thresholds)}.`
    );
  }

  const tokens = (value) => value.toLocaleString('en-US');
  return (
    `📌 **This project's soft threshold is ${tokens(thresholds.soft)} tokens of context in use, ` +
    `and its hard threshold is ${tokens(thresholds.hard)}.** They are set under \`thresholds\` in ` +
    '`jtrek.json`.'
  );
}

/**
 * Returns the pointer that goes into an instruction file, without its markers.
 *
 * The pointer is deliberately short. It names the rules document and states each of the four rules
 * in one line, so that an agent that follows no references still has them. It leaves the reasoning
 * to the rules document itself. Instruction files are loaded in every session and compete for
 * space, so the long form belongs in a document that is read when needed.
 *
 * A store migrated from jtrack keeps the old name in the text of its records, because `R-000600`
 * limits the migration to the header and the chain. The pointer therefore carries a paragraph that
 * explains the name, but only when the store holds it, so a project that adopted jtrek directly
 * never reads about a name it has never used (`R-000632` to `R-000634`).
 */
export function renderBlock(store) {
  const pointer = renderTemplate('pointer.md', store).trim();
  if (!storeMentionsFormerName(store)) return pointer;
  return `${pointer}\n\n${renderTemplate('former-name.md', store).trim()}`;
}

/**
 * Returns whether any row or prose file in the store contains the name jtrack, in any letter case.
 *
 * The registry is searched as text rather than through `jtrek query`, because a query sees only each
 * record's current revision, and an agent can still read the earlier ones with `jtrek history`. The
 * name holds no character that JSON escapes, so it appears in the file as it was written.
 */
function storeMentionsFormerName(store) {
  const mentions = (text) => text !== null && /jtrack/i.test(text);
  if (mentions(readIfPresent(store.registryPath))) return true;
  if (!fs.existsSync(store.recordsDir)) return false;
  return fs
    .readdirSync(store.recordsDir)
    .filter((name) => name.endsWith('.md'))
    .some((name) => mentions(readIfPresent(path.join(store.recordsDir, name))));
}

/** Returns the rules document, which is the single copy that every instruction file points to. */
export function renderRulesDoc(store) {
  return renderTemplate('rules.md', store);
}

export function renderClosingDoc(store, { frontmatter }) {
  const text = renderTemplate('closing-a-session.md', store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns the procedure for opening a session, which decides what to work on from evidence rather
 * than from whatever the agent happened to read first.
 *
 * It is the counterpart to `renderClosingDoc`, and it is rendered in the same two forms for the
 * same reason. The substance must not live only in the skill file. `.claude/skills/` is specific to
 * one vendor, so a procedure that existed only there would leave every other agent with no opening
 * procedure at all. `R-0047` records this.
 */
export function renderOpeningDoc(store, { frontmatter }) {
  const text = renderTemplate('opening-a-session.md', store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns the planning procedure, which interviews the owner, writes the plan document and records
 * what the interview settles through the normal checkout and check-in loop.
 *
 * It is rendered in the same two forms as the session procedures, for the same reason. The copy
 * beside the store serves every agent, and the Claude Code skill is that text with frontmatter
 * added. `R-000178` holds the design the procedure follows, and `R-000185` records how it was
 * written.
 */
export function renderPlanningDoc(store, { frontmatter }) {
  const text = renderTemplate('planning.md', store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns the procedure for writing code, which combines spec-driven and test-driven development:
 * the requirement is agreed first, then a test naming it is seen failing, then the code is written,
 * and the requirement goes into force only in the check-in that lands the passing test.
 *
 * It is rendered in the same two forms as the planning procedure, for the same reason. The copy
 * beside the store serves every agent, and the Claude Code skill loads it at the moment code is
 * about to be written, which is where `R-000177` says a rule belongs. `R-000204` records how it was
 * written, and `R-000371` the decision that a requirement is in force only once a test verifies it.
 */
export function renderCodingDoc(store, { frontmatter }) {
  const text = renderTemplate('writing-code.md', store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns the procedure for reviewing a finished feature or plan section, in either of its two
 * forms.
 *
 * `R-000417` decided that a finished feature, and then a finished plan section, gets three reviews
 * before it merges: an agent refactors the code against the coding standards, an agent from
 * another family of models reviews the result, and the owner reads a report. `R-000428` wrote the
 * procedure, replacing the review of one record that `R-000409` had built. The copy beside the
 * store serves every agent. Since `R-000530`, this procedure only sets the review up, and each
 * stage of the review runs in a session of its own. The procedure also keeps the list of one-way
 * doors that the report and the closing procedure both use, and Part B, which `jtrek cross-review`
 * hands to the cross-family reviewer.
 */
export function renderReviewingDoc(store, { frontmatter }) {
  const text = renderTemplate('reviewing.md', store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns the procedure of one stage of the review, in either of its two forms.
 *
 * The review procedure once ran all three of its stages itself: the refactoring review, the
 * cross-family review and the arbitration of the findings. The owner wanted to be able to skip a
 * stage, and a single procedure full of conditions for skipping is hard for an agent to follow.
 * `R-000527` therefore gave each stage a procedure and a skill of its own. `R-000530` then made each
 * stage a session of its own with a task record of its own, so that a stage which reaches the hard
 * threshold stops and resumes the way any other record does. The owner's report and the merge
 * became a fourth stage, `review-report.md`, because a report placed at the end of the arbitration
 * would have nowhere to run when the arbitration is skipped. `template` is the file name in
 * `rules/`, such as `review-refactor.md`.
 */
export function renderReviewStageDoc(template, store, { frontmatter }) {
  const text = renderTemplate(template, store);
  return frontmatter ? text : withoutFrontmatter(text);
}

/**
 * Returns one of the three maps, named by its file in `rules/`.
 *
 * Each stage of jtrek's workflow is described in its own procedure, so no single procedure shows
 * how the stages connect. `R-000534` drew them as three maps written for people: `map-overall.md`
 * draws the whole workflow conceptually, `map-work.md` draws one session of code or other work, and
 * `map-review.md` draws the review of a finished feature or plan section. The owner chose that every
 * project receives all three (`R-000537`, `R-000538`, `R-000539`). A map has no skill form, because
 * nothing is run from it.
 */
export function renderMapDoc(name, store) {
  return renderTemplate(name, store);
}

/**
 * Returns the starting template for the project's hand-off. It is a starting point for a person to
 * fill in, not a generated document.
 *
 * It is rendered only when the file does not exist, exactly as `renderPlanDoc` is. It exists
 * because the closing procedure names five sections and tells the agent to rewrite the ones that
 * changed. Without a starting file, those instructions would ask the agent to edit a document that
 * nothing had created.
 */
export function renderHandoffFile(store) {
  return renderTemplate('handoff.md', store);
}

/**
 * Returns the procedure for stopping when the agent's context fills up, and for resuming
 * afterwards.
 */
export function renderSessionDoc(store) {
  return renderTemplate('session.md', store);
}

/**
 * Returns the glossary, which defines the terms used by the rules and the procedures that a reader
 * cannot look up anywhere else.
 *
 * It is a document of its own rather than a section of another, because a reader consults a
 * glossary when meeting a term rather than reading it from start to finish. Every other document
 * therefore links to it by path. `R-0093` records this.
 */
export function renderGlossaryDoc(store) {
  return renderTemplate('glossary.md', store);
}

/**
 * Returns the record schema, which says what a record is, as opposed to what a session does with
 * one.
 *
 * It is installed because an agent in an adopting project would otherwise have no way to learn that
 * it exists. The file is inside the npm package, at `node_modules/jtrek/rules/schema.md`, and
 * nothing used to point to it. The gap matters most when an agent writes a row from nothing, rather
 * than when a bad row is refused. `jtrek checkout --id` writes a record's full current state into
 * `work.json`, so an agent revising a record edits a structure that is already in front of it.
 * `jtrek checkout --new` writes an empty array, so an agent adding the session's first record has
 * to build the object from nothing.
 *
 * Installing the whole document, and generating it, is what keeps the repetition safe. The owner
 * judged the content worth some overlap with `rules.md` and the glossary. Overlapping text is
 * dangerous only when its copies have no single source. This copy is rendered from
 * `rules/schema.md` and compared by `--check`, exactly like the other generated documents, so the
 * installed copy cannot drift from its source. Installing an extract would have been unsafe. Every
 * later edit to the source would then need somebody to decide whether the changed paragraph fell
 * inside the extract or outside it, and nothing would record that decision.
 *
 * It is the one installed document that cites no record ids. The others may cite them, because
 * they describe this project's own rules. This one is read in adopting projects, whose stores do
 * not contain records such as `R-0123`. Reasoning that needs a citation belongs in jtrek's own
 * store instead.
 */
export function renderSchemaDoc(store) {
  return renderTemplate('schema.md', store);
}

/**
 * Returns the instruction to write the store's files with the file-editing tools. It is installed
 * for Claude Code alongside the guard hook.
 *
 * The instruction does not make the guard cover every write, but it makes clear which writes the
 * guard does not cover. The hook is triggered only by the file-editing tools, so the guard never
 * sees a session that writes through the shell. How often a session does that depends on a system
 * prompt that nobody can see from inside the session, as `R-0039` found. Once the choice of tool is
 * written down, a write through the shell breaks a stated instruction, rather than breaking nothing.
 * `R-000140` records this.
 *
 * The instruction goes in `.claude/rules/`, not in the pointer. The pointer is written into
 * `AGENTS.md` as well as `CLAUDE.md`, and the tool names belong to one vendor. Claude Code loads
 * every file in `.claude/rules/` at the start of a session, and no other agent reads that directory.
 */
export function renderToolsRule(store) {
  return renderTemplate('claude-tools.md', store);
}

/**
 * Returns the starting template for the project's plan document. It is a starting point for a
 * person to fill in, not a generated document.
 *
 * It is rendered only when the file does not exist. Everything else this module writes describes
 * the installed jtrek, so it is safe to overwrite. The plan document describes the project's own
 * work, so it is not.
 */
export function renderPlanDoc(store) {
  return renderTemplate('plan.md', store);
}

/**
 * Returns the starting template for the project's spec document, for the same reason and under the
 * same rule as `renderPlanDoc`. `src/spec.js` explains the document's shape.
 */
export function renderSpecDoc(store) {
  return renderTemplate('spec.md', store);
}

/**
 * Returns jtrek's base set of coding standards, from which a project's own `coding-standards.md`
 * starts. It is rendered only when the file does not exist, under the same rule as
 * `renderPlanDoc`.
 *
 * `R-000417` decided that only the agent refactoring a finished feature reads the standards, and
 * that each project then grows its own. The file is therefore the project's from the moment it is
 * created. `R-000424` built this, and `R-000455` to `R-000458` state how install, the gate and
 * uninstall treat the file.
 */
export function renderCodingStandards(store) {
  return renderTemplate('coding-standards.md', store);
}

/** Returns the content currently between the markers, or null when there is no block. */
export function extractBlock(text) {
  const start = text.indexOf(BEGIN);
  if (start === -1) return null;
  const afterMarker = text.indexOf('-->', start);
  if (afterMarker === -1) return null;
  const end = text.indexOf(END, afterMarker);
  if (end === -1) return null;
  return text.slice(afterMarker + 3, end).trim();
}

/**
 * Puts the block into a document, replacing any block already there.
 *
 * Running it twice gives the same result as running it once. The markers enclose exactly the text
 * jtrek owns, so everything the user wrote outside them is left untouched by a reinstall.
 */
export function upsertBlock(existing, block) {
  const wrapped = `${BEGIN} — generated by jtrek ${version()}; edit jtrek's rules/, not this block -->\n\n${block}\n\n${END}`;

  if (existing === null) return `${wrapped}\n`;

  const start = existing.indexOf(BEGIN);
  if (start === -1) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    return `${existing}${separator}${wrapped}\n`;
  }

  const end = existing.indexOf(END, start);
  if (end === -1) {
    throw new Error(
      `A '${BEGIN}' marker has no matching '${END}'. Repair or remove the block by hand — ` +
        `overwriting from here could discard text that is not jtrek's.`
    );
  }
  return existing.slice(0, start) + wrapped + existing.slice(end + END.length);
}

/**
 * Takes the block out again, leaving everything the user wrote around it.
 *
 * It returns null when there was no block. The caller can then tell the difference between having
 * removed a block and having found nothing to remove, and it can report accurately rather than
 * claiming work it did not do. The markers default to jtrek's own, and removing what jtrack left
 * passes jtrack's.
 */
export function removeBlock(existing, { begin = BEGIN, end: endMarker = END } = {}) {
  if (existing === null) return null;
  const start = existing.indexOf(begin);
  if (start === -1) return null;

  const end = existing.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error(
      `A '${begin}' marker has no matching '${endMarker}'. Remove the block by hand — guessing where ` +
        `it ends could discard text that is not jtrek's.`
    );
  }

  const before = existing.slice(0, start).replace(/\n+$/, '');
  const after = existing.slice(end + endMarker.length).replace(/^\n+/, '');
  if (before === '' && after === '') return '';
  if (before === '' || after === '') return `${before}${after}\n`;
  return `${before}\n\n${after}`;
}

/**
 * Takes the hook entry out of a settings file, leaving every other setting alone.
 *
 * Containers left empty are removed, so that an uninstall does not leave
 * `"hooks": { "PreToolUse": [] }` behind. An empty entry like that looks like a deliberate
 * configuration rather than something left over. The file itself is never deleted, because the
 * user's other settings are in it.
 */
export function removeHook(settings) {
  let removed = false;
  for (const { event, command } of HOOKS) {
    const events = settings?.hooks?.[event];
    if (!Array.isArray(events)) continue;
    const kept = events.filter((entry) => !namesCommand(entry, command));
    if (kept.length === events.length) continue;
    removed = true;
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (removed && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed;
}

/**
 * Takes jtrack's hooks out of a settings file, leaving everything else, and reports whether it
 * found any.
 *
 * Unlike `removeHook`, it removes a hook rather than a whole entry. An entry can hold several hooks,
 * and a hook that somebody added beside jtrack's is still wanted. An entry or a container left empty
 * is removed, for the reason `removeHook` gives.
 */
function removeFormerHooks(settings) {
  let removed = false;
  for (const [event, entries] of Object.entries(settings?.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    const kept = [];
    for (const entry of entries) {
      const hooks = (entry.hooks ?? []).filter((hook) => !FORMER_HOOK_COMMAND.test(hook.command ?? ''));
      if (hooks.length === (entry.hooks ?? []).length) {
        kept.push(entry);
        continue;
      }
      removed = true;
      if (hooks.length > 0) kept.push({ ...entry, hooks });
    }
    if (kept.length > 0) settings.hooks[event] = kept;
    else if (entries.length > 0) delete settings.hooks[event];
  }
  if (removed && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed;
}

function readIfPresent(filePath) {
  return fs.existsSync(filePath) ? readText(filePath) : null;
}

/**
 * Reads a file exactly as it is on disk, line endings included. Only the writes into `AGENTS.md`
 * and `CLAUDE.md` need this, because those files belong to the project, and jtrek writes its
 * pointer into them with the line endings the project chose (`R-000400`).
 */
function readRawIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

/**
 * Removes empty directories, starting at `from` and moving up towards `stopAt`. It stops at the
 * first directory that is not empty.
 */
function pruneEmptyDirs(from, stopAt) {
  let dir = from;
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    else return;
    dir = path.dirname(dir);
  }
}

/**
 * Writes an instruction file's text once a block has been taken out of it, keeping the file's line
 * endings. A file left with nothing but whitespace is one that the tool created and has now emptied,
 * so it is removed, which leaves the project as it was found. If the user wrote any prose in it, the
 * file is kept.
 */
function writeWithoutBlock(file, stripped) {
  if (isLeftEmpty(stripped)) fs.rmSync(file);
  else fs.writeFileSync(file, withLineEndingsOf(readRawIfPresent(file), stripped));
}

const isLeftEmpty = (stripped) => stripped.trim() === '';

/**
 * Removes a file the tool installed, and then each directory above it that the removal left empty,
 * stopping at the project's root. A skill's directory would otherwise be left behind with nothing
 * in it.
 */
function removeFileAndEmptyDirs(filePath, projectRoot) {
  fs.rmSync(filePath);
  pruneEmptyDirs(path.dirname(filePath), projectRoot);
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/**
 * Returns the path where a project's choice of agent vendor is written and read back from.
 *
 * A project may have no `jtrek.json` at all, and `R-0019` settled that a missing configuration
 * file is not a failure. In that case the function returns the path at which the file would be
 * created. Nothing reads from that path until something has written to it.
 */
function configPathFor(store) {
  return store.configPath ?? path.join(store.projectRoot, 'jtrek.json');
}

/**
 * Returns what the project recorded about its Claude Code integration, or `null` if it recorded
 * nothing.
 *
 * The choice is stored under `agents.claude`, nested rather than at the top level, so that a second
 * vendor would not need a second top-level key. `hook` is stored with its final value on every
 * install, and not only when it differs from the default. A project that accepted the default can
 * then be told apart from one that never chose. If jtrek's own default changed later, it could not
 * silently change what an installed project receives on its next upgrade. That silent change would
 * be the same kind of fault as the one `R-0034` recorded.
 */
export function recordedChoice(store) {
  const claude = store.config?.agents?.claude;
  if (claude === undefined || claude === null) return null;
  return { claude: true, hook: claude.hook !== false };
}

/**
 * Works out what a project that recorded nothing appears to have chosen, from the files on disk.
 *
 * This exists for projects installed before the choice was recorded anywhere. Without it, every one
 * of those projects would stay in the reinstall loop that `R-0034` describes until somebody read a
 * release note and re-ran the install by hand. The evidence needed to avoid that is already in the
 * repository.
 *
 * It returns `null` when nothing specific to Claude Code is present. That means the project never
 * opted in, rather than that its choice was lost.
 */
export function inferredChoice(store, t) {
  // What jtrack installed counts as evidence too. `install` removes it, so a project that recorded
  // nothing would otherwise lose its skills and its guard in the run that migrates it (`R-000649`).
  const skills =
    claudeSkills(store, t).some(({ file }) => fs.existsSync(file)) ||
    formerSkillFiles(store).some((file) => fs.existsSync(file));
  const hook = hookState(t.settingsFile).status !== 'absent' || holdsFormerHook(t.settingsFile);
  if (!skills && !hook) return null;
  return { claude: true, hook };
}

/**
 * Writes the choice into `jtrek.json`, leaving every other key exactly as it was.
 *
 * The file belongs to the project, not to jtrek. It already says where the store is and may carry
 * `instructions`, `markdown` and `check`. This function therefore reads what is there, changes one
 * key and writes the result back, rather than generating the file from scratch.
 */
function writeChoice(store, choice) {
  const configPath = configPathFor(store);
  const text = readIfPresent(configPath);

  let config;
  if (text === null) config = {};
  else {
    try {
      config = JSON.parse(text);
    } catch (error) {
      logger.error(`${configPath} is not valid JSON, so the vendor choice cannot be recorded.`);
      throw new Error(`${configPath} is not valid JSON: ${error.message}`, { cause: error });
    }
  }

  config.agents ??= {};
  config.agents.claude = { hook: choice.hook };
  write(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

/**
 * Takes the vendor choice out of `jtrek.json` again, and removes any containers left empty.
 */
export function removeChoice(config) {
  if (config?.agents?.claude === undefined) return false;
  delete config.agents.claude;
  if (Object.keys(config.agents).length === 0) delete config.agents;
  return true;
}

/**
 * Returns the hook entry that `--claude` writes. It is the one definition that both the installer
 * and `hookState` read.
 *
 * It returns a new object on every call, rather than being a constant. `installHook` puts the
 * returned object into a settings file and then writes the file. A shared object could be changed
 * by one caller, and that change would silently alter what every later call installs.
 */
function guardEntry() {
  return {
    matcher: 'Edit|Write|MultiEdit|NotebookEdit',
    hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 5 }],
  };
}

/**
 * Returns the settings entry for the threshold hook. Its matcher is `*`, because context grows with
 * every tool call, whichever tool made it. A project with no thresholds still receives the entry,
 * and the command then prints nothing, so the hook needs no reinstall when thresholds are added.
 */
function thresholdEntry() {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command: THRESHOLD_COMMAND, timeout: 5 }],
  };
}

/**
 * jtrek's hooks, each with the event it runs on and the command that identifies its entry. The
 * install, the check and the uninstall all work through this list, so that the guard and the
 * threshold hook are installed, reported and removed together.
 */
const HOOKS = [
  { event: 'PreToolUse', command: GUARD_COMMAND, entry: guardEntry },
  { event: 'PostToolUse', command: THRESHOLD_COMMAND, entry: thresholdEntry },
];

const namesCommand = (entry, command) =>
  (entry.hooks ?? []).some((hook) => (hook.command ?? '').includes(command));

/**
 * Reports what the project's settings file actually says about the guard hook, as one of four
 * states:
 *
 * - `absent` means there is no settings file, or none of its entries names the guard command.
 * - `current` means an entry names the guard and matches what `install --claude` writes today.
 * - `stale` means an entry names the guard but differs from what this jtrek would install, so the
 *   hook that runs is not the one this jtrek would install. A matcher narrowed by hand and an entry
 *   left by an older jtrek both end up here.
 * - `unreadable` means the settings file is not valid JSON, so nothing can be said about the hook.
 *
 * `unreadable` is returned rather than thrown as an error. This is the one place where the function
 * handles the fault differently from `readConfig`. Both of its callers report rather than act.
 * `--check` turns it into a gate failure that names the file, and `jtrek start` lists it among the
 * blockers. `jtrek start` is designed to exit with 0 whatever it finds, so that a session resuming
 * interrupted work never opens by reading a crash. A settings file that the user edits by hand is
 * exactly the kind of thing that could otherwise crash it. `installHook` still throws an error for
 * the same file, and that is correct, because installing acts on the file rather than reporting on
 * it.
 *
 * The guard is found by looking for `GUARD_COMMAND` inside an entry's command, which is also how
 * `installHook` and `removeHook` find it. An entry that names some other command is somebody else's
 * hook. It is not jtrek's concern, and it does not make this function report `stale`.
 *
 * The comparison checks named fields rather than comparing serialized objects, because a settings
 * file is edited by hand and by other tools. Two entries that differ only in the order of their keys
 * are the same hook. A gate that reported that as a difference would fail for a reason its reader
 * could not see in the file.
 */
export function hookState(settingsPath) {
  const text = readIfPresent(settingsPath);
  if (text === null) return { status: 'absent' };

  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    // The parse error's message is returned in `why`, so that the caller can report what the fault
    // was and not only that there was one. Nothing about the error is lost.
    return { status: 'unreadable', why: error.message };
  }

  // Each of jtrek's hooks is compared on its own. The file is `absent` only when none of them is
  // there, and `current` only when all of them are. A file with the guard but not the threshold
  // hook, which is what a project installed before `R-000370` has, is therefore `stale`, and a
  // reinstall adds the missing entry.
  const states = HOOKS.map(({ event, command, entry }) => {
    const events = settings?.hooks?.[event];
    const found = Array.isArray(events) ? events.find((e) => namesCommand(e, command)) : undefined;
    if (found === undefined) return 'absent';
    const ours = entry();
    const theirs = (found.hooks ?? []).find((h) => (h.command ?? '').includes(command));
    const matches =
      found.matcher === ours.matcher &&
      (found.hooks ?? []).length === ours.hooks.length &&
      theirs?.type === ours.hooks[0].type &&
      theirs?.command === ours.hooks[0].command &&
      theirs?.timeout === ours.hooks[0].timeout;
    return matches ? 'current' : 'stale';
  });

  if (states.every((state) => state === 'absent')) return { status: 'absent' };
  return { status: states.every((state) => state === 'current') ? 'current' : 'stale' };
}

/**
 * Returns the path of the user's own Claude Code settings file, which Claude Code reads in every
 * session it starts.
 *
 * This exists because a project's `.claude/settings.json` takes effect only in a session started
 * in the project's own directory. `R-0045` observed that Claude Code does not read `.claude/` from a
 * directory below the one in which a session starts. A session started one level above the project
 * therefore runs without the guard, and nothing reports that, as `R-000160` found. The user-level
 * file is read wherever the session starts. The guard finds the store from the path of the file
 * being edited, and it allows every edit where there is no store. Installing it at user level is
 * therefore harmless in unrelated projects.
 *
 * Claude Code uses a different directory when `CLAUDE_CONFIG_DIR` is set, so jtrek does the same.
 */
export function userSettingsPath(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

/**
 * Returns the full path of the executable that the command `name` would run, or `null` when no
 * directory on `PATH` contains it.
 *
 * This exists because a hook whose command is missing protects nothing and reports nothing. The
 * shell exits with 127 for a command it cannot find, and Claude Code refuses an edit only when a
 * hook exits with 2. The edit therefore goes through, and no message is shown anywhere, as `R-0043`
 * found. The hook names the bare command `jtrek` rather than a full path, because
 * `.claude/settings.json` is committed, and a path belonging to one machine would be wrong on every
 * other machine.
 *
 * The function searches the `PATH` of the current process, but Claude Code may run the hook with a
 * different `PATH`. It therefore catches a command that is missing from the machine altogether,
 * which is the usual case. A command it finds may still be missing from the hook's environment.
 */
export function commandOnPath(name, env = process.env) {
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch (error) {
    // A PATH entry that does not exist, that is not a directory, or that holds a file this user may
    // not run simply does not contain the command. Any other error is a real fault, so it is
    // raised rather than treated as the command not being there.
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
}

/** The executable that the guard hook runs, which is the first word of its command. */
const GUARD_EXECUTABLE = GUARD_COMMAND.split(' ')[0];

/**
 * Returns the message reporting that the guard hook in `settingsPath` cannot run, together with
 * its remedy.
 *
 * The remedy must never be `npm i -g jtrek`. jtrek is not published, and the name `jtrek` on the
 * npm registry belongs to an unrelated package, so that command would install the wrong tool.
 *
 * A release of jtrek is a git tag, installed globally with npm from that tag (R-000175), so the
 * remedy names that install for the version that is running. It does not suggest `npm link`,
 * because that links the command to a working copy, and the tool would then change with every
 * edit made there.
 */
function unresolvedGuardMessage(settingsPath) {
  const tag = `v${version()}`;
  return (
    `The guard hook in ${settingsPath} runs '${GUARD_EXECUTABLE}', which is not on this machine's ` +
    'PATH. The shell exits 127, which Claude Code does not treat as a refusal, so the hook allows ' +
    `every edit. Install a tagged release of jtrek to put it there: 'npm i -g github:wwolfyy/jtrek#${tag}' ` +
    `from GitHub, or 'npm i -g git+file:///<path to a clone of jtrek>#${tag}' from a local clone.`
  );
}

/**
 * Returns the problem with the project's guard hook that lies on this machine rather than in the
 * project's files, or `null` when there is none.
 *
 * It is kept separate from `instructionProblems` because the remedy differs. Every problem that
 * `instructionProblems` reports is fixed by `jtrek agent install`, and `check` prints that remedy
 * once for all of them. A missing command is not fixed by reinstalling, so it carries its own
 * remedy.
 *
 * A problem is reported only for a hook that the project's settings actually contain. With no hook,
 * nothing fails to run. A hook that the project has chosen but that is missing from its settings is
 * already reported by `instructionProblems`.
 */
export function guardCommandProblem(store, env = process.env) {
  const settingsPath = targets(store).settingsFile;
  const { status } = hookState(settingsPath);
  if (status !== 'current' && status !== 'stale') return null;
  return commandOnPath(GUARD_EXECUTABLE, env) === null ? unresolvedGuardMessage(settingsPath) : null;
}

/**
 * Installs the Claude Code `PreToolUse` hook into the project's committed settings.
 *
 * The hook goes in `.claude/settings.json` and never in `settings.local.json`. A command that runs
 * on every matching tool call should be visible in review, and a local settings file is not
 * committed, so nobody reviews it.
 *
 * The entry only calls `jtrek guard`, rather than containing the guard's logic. Improving the
 * guard therefore never means rewriting a file that the user also edits.
 */
export function installHook(settingsPath) {
  const settings = JSON.parse(readIfPresent(settingsPath) ?? '{}');
  settings.hooks ??= {};

  // The result is 'added' when the guard was not there before, and 'refreshed' otherwise, which is
  // what callers reported before the threshold hook joined it.
  let guardExisted = false;
  for (const { event, command, entry } of HOOKS) {
    const events = (settings.hooks[event] ??= []);
    const existing = events.findIndex((e) => namesCommand(e, command));
    if (command === GUARD_COMMAND) guardExisted = existing !== -1;
    if (existing === -1) events.push(entry());
    else events[existing] = entry();
  }

  write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return guardExisted ? 'refreshed' : 'added';
}

/**
 * Returns every document that `install` writes again on each run, in the order it writes them.
 * Each entry holds the document's path, a function that renders its text, and an optional phrase
 * that `install` adds to the line saying it wrote the document.
 *
 * `install` writes each of these documents, `instructionProblems` compares each with what this
 * jtrek renders, and `uninstall` removes each. They read this one list, so a document added to
 * jtrek is added here rather than to each of the three. The text is rendered only when a caller
 * asks for it, because `uninstall` needs only the paths.
 */
function regeneratedDocs(store, t) {
  return [
    { file: t.rulesDoc, render: () => renderRulesDoc(store), what: 'the one copy of the rules' },
    { file: t.closingDoc, render: () => renderClosingDoc(store, { frontmatter: false }) },
    { file: t.openingDoc, render: () => renderOpeningDoc(store, { frontmatter: false }) },
    { file: t.planningDoc, render: () => renderPlanningDoc(store, { frontmatter: false }) },
    { file: t.codingDoc, render: () => renderCodingDoc(store, { frontmatter: false }) },
    { file: t.reviewingDoc, render: () => renderReviewingDoc(store, { frontmatter: false }) },
    { file: t.reviewRefactorDoc, render: () => renderReviewStageDoc('review-refactor.md', store, { frontmatter: false }) },
    { file: t.reviewCrossDoc, render: () => renderReviewStageDoc('review-cross.md', store, { frontmatter: false }) },
    { file: t.reviewArbitrateDoc, render: () => renderReviewStageDoc('review-arbitrate.md', store, { frontmatter: false }) },
    { file: t.reviewReportDoc, render: () => renderReviewStageDoc('review-report.md', store, { frontmatter: false }) },
    { file: t.mapOverallDoc, render: () => renderMapDoc('map-overall.md', store) },
    { file: t.mapWorkDoc, render: () => renderMapDoc('map-work.md', store) },
    { file: t.mapReviewDoc, render: () => renderMapDoc('map-review.md', store) },
    { file: t.sessionDoc, render: () => renderSessionDoc(store) },
    { file: t.glossaryDoc, render: () => renderGlossaryDoc(store) },
    { file: t.schemaDoc, render: () => renderSchemaDoc(store), what: 'what a record is' },
  ];
}

/**
 * Returns every Claude Code skill that `install` writes when the project chose the Claude Code
 * integration, in the order it writes them, as entries of a path and a function that renders the
 * skill's text. Like `regeneratedDocs`, it is the one list that `install`, `instructionProblems`,
 * `inferredChoice` and `uninstall` read.
 */
function claudeSkills(store, t) {
  return [
    { file: t.skillFile, render: () => renderClosingDoc(store, { frontmatter: true }) },
    { file: t.startSkillFile, render: () => renderOpeningDoc(store, { frontmatter: true }) },
    { file: t.planSkillFile, render: () => renderPlanningDoc(store, { frontmatter: true }) },
    { file: t.codeSkillFile, render: () => renderCodingDoc(store, { frontmatter: true }) },
    { file: t.reviewSkillFile, render: () => renderReviewingDoc(store, { frontmatter: true }) },
    { file: t.reviewRefactorSkillFile, render: () => renderReviewStageDoc('review-refactor.md', store, { frontmatter: true }) },
    { file: t.reviewCrossSkillFile, render: () => renderReviewStageDoc('review-cross.md', store, { frontmatter: true }) },
    { file: t.reviewArbitrateSkillFile, render: () => renderReviewStageDoc('review-arbitrate.md', store, { frontmatter: true }) },
    { file: t.reviewReportSkillFile, render: () => renderReviewStageDoc('review-report.md', store, { frontmatter: true }) },
  ];
}

const formerSkillFiles = (store) =>
  FORMER_SKILLS.map((name) => path.join(store.projectRoot, '.claude', 'skills', name, 'SKILL.md'));

/**
 * Returns whether a settings file holds one of jtrack's hooks. A file that is not valid JSON holds
 * none as far as this function can tell. `hookState` is what reports such a file, so this function
 * does not report it a second time, and `--check` and `jtrek start` do not stop at it.
 */
function holdsFormerHook(settingsPath) {
  const text = readIfPresent(settingsPath);
  if (text === null) return false;
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  return removeFormerHooks(settings);
}

/**
 * Returns the instruction files that hold jtrack's block, each once. Both file names are searched
 * whatever `--instructions` says, because that option limits where jtrek's pointer goes, and a
 * block left in the other file would still be read by an agent.
 */
function filesHoldingFormerBlock(store, t) {
  const byRealPath = new Map();
  for (const file of [...resolveInstructions(store).files, ...t.instructionFiles]) {
    if (!fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (!byRealPath.has(real) && readText(file).includes(FORMER_MARKERS.begin)) byRealPath.set(real, file);
  }
  return [...byRealPath.values()];
}

/**
 * Returns each thing jtrack installed that is still in the project. Each entry holds the path and a
 * description, which `--check` reports, and a function, which `install` calls to remove it. The two
 * read this one list, so that the gate fails on exactly what its remedy clears.
 */
function formerLeftovers(store, t) {
  const leftovers = filesHoldingFormerBlock(store, t).map((file) => ({
    path: file,
    what: "jtrack's block",
    remove: () => writeWithoutBlock(file, removeBlock(readText(file), FORMER_MARKERS)),
  }));
  if (holdsFormerHook(t.settingsFile)) {
    leftovers.push({
      path: t.settingsFile,
      what: "jtrack's hooks",
      remove: () => {
        const settings = JSON.parse(readText(t.settingsFile));
        removeFormerHooks(settings);
        write(t.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      },
    });
  }
  const ruleFile = path.join(store.projectRoot, '.claude', 'rules', 'jtrack.md');
  for (const file of [...formerSkillFiles(store), ruleFile]) {
    if (!fs.existsSync(file)) continue;
    leftovers.push({
      path: file,
      what: 'a file jtrack installed',
      remove: () => removeFileAndEmptyDirs(file, store.projectRoot),
    });
  }
  return leftovers;
}

/**
 * Throws when an instruction file has jtrack's begin marker and no end marker after it. Without the
 * end marker, nothing says where jtrack's text stops and the project's text begins. `install` calls
 * this before it writes anything, so that a refusal leaves the project as it was.
 */
function requireFormerBlocksClosed(store, t) {
  for (const file of filesHoldingFormerBlock(store, t)) {
    const text = readText(file);
    if (text.indexOf(FORMER_MARKERS.end, text.indexOf(FORMER_MARKERS.begin)) === -1) {
      throw new Error(
        `${file} has a '${FORMER_MARKERS.begin}' marker with no '${FORMER_MARKERS.end}' after it, so ` +
          `nothing says where jtrack's text ends. Remove that block by hand, then run this again. ` +
          `Nothing was written.`
      );
    }
  }
}

/**
 * Changes the commands that the comments of the store's `.gitignore` name from jtrack to jtrek.
 * `jtrack init` wrote those comments, and `jtrek migrate --from-jtrack` moves the file unchanged
 * (`R-000644`). Only a comment line is changed, and only a quoted command in it, because the other
 * lines are the project's rules, and a rule that happens to name jtrack is still what the project
 * asked git to ignore.
 */
function renameCommandsInGitignore(store) {
  const file = path.join(store.dir, '.gitignore');
  const text = readRawIfPresent(file);
  if (text === null) return;
  const renamed = text.replace(/^[ \t]*#.*$/gm, (line) => line.replace(/'jtrack ([a-z-]+)'/g, "'jtrek $1'"));
  if (renamed === text) return;
  fs.writeFileSync(file, renamed);
  logger.info(`Changed the commands named in the comments of ${file} from jtrack to jtrek.`);
}

/**
 * Removes what an earlier version of the tool installed and this one no longer writes.
 *
 * It runs at the end of `install`, after the replacements are written, so that a run stopped
 * partway never leaves a project with neither tool's guard. It also needs to run after the choice
 * is worked out, because `inferredChoice` reads what this removes.
 */
function removeWhatEarlierVersionsLeft(store, t) {
  for (const { path: file, what, remove } of formerLeftovers(store, t)) {
    remove();
    logger.info(`Removed ${what}: ${file}.`);
  }
  renameCommandsInGitignore(store);
  // Older builds generated these documents, and nothing else would remove them from a project short of
  // an uninstall. Each is generated text, so removing it loses nothing the project wrote (`R-000652`).
  for (const file of t.legacyDocs) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file);
    logger.info(`Removed ${file}, which this jtrek no longer writes.`);
  }
}

function install(args, store) {
  const t = targets(store, { instructions: args.instructions });
  requireFormerBlocksClosed(store, t);
  const block = renderBlock(store);
  // The thresholds are read before anything is written. A malformed setting then stops the install
  // with every document as it was, rather than partway through, with some documents rewritten and
  // the session document not.
  renderThresholds(store.config);

  for (const link of t.instructions.linked) {
    logger.info(`${link.name} is the same file as ${link.sameFileAs} — writing it once.`);
  }

  for (const file of t.instructionFiles) {
    const raw = readRawIfPresent(file);
    write(file, withLineEndingsOf(raw, upsertBlock(readIfPresent(file), block)));
    logger.info(`Wrote the jtrek pointer into ${file}.`);
  }

  for (const { file, render, what } of regeneratedDocs(store, t)) {
    write(file, render());
    logger.info(`Wrote ${file}${what ? ` — ${what}` : ''}.`);
  }

  // These four files are created from a template only when missing, and they are never regenerated.
  // Overwriting any of them on a reinstall would replace the project's own writing with an empty
  // template, and reinstalling is routine, because it happens on every jtrek upgrade. The hand-off
  // is created rather than left missing because the closing procedure names five sections and says
  // to rewrite the ones that changed. Without a starting file, those instructions would ask the agent
  // to edit a document that nothing had created. The coding standards are created for a similar
  // reason: the review of a finished feature stops when they are missing.
  for (const [filePath, render, what] of [
    [t.planDoc, renderPlanDoc, 'planning'],
    [t.specDoc, renderSpecDoc, 'spec'],
    [t.handoffFile, renderHandoffFile, 'hand-off'],
    [t.codingStandardsFile, renderCodingStandards, 'coding standards'],
  ]) {
    if (fs.existsSync(filePath)) {
      logger.info(`${filePath} is already there — left as it is.`);
    } else {
      write(filePath, render(store));
      logger.info(
        `Created ${filePath} — your ${what}, to edit; 'jtrek agent install' will not write to it ` +
          'again.'
      );
    }
  }

  if (args.hooksAlias) {
    logger.warn(
      '--hooks is now part of --claude, which installs the guard hook unless you pass --no-hook. ' +
        'Treating this run as --claude.'
    );
  }

  // This is the fix for R-0034. A run that passes flags is the project making a choice. A run that
  // passes none repeats what the project chose last time. Before this fix, a reinstall without
  // flags installed less than the previous install had, and nothing recorded anywhere could have
  // told it otherwise.
  let choice;
  if (args.claude) choice = { claude: true, hook: !args.noHook };
  else {
    choice = recordedChoice(store);
    // Nothing is recorded. The project may have been installed before choices were recorded, so
    // its files are read, rather than a missing key being treated as a decision against. If this
    // still gives `null`, the project really never opted in, and it stays opted out.
    if (choice === null) {
      const found = inferredChoice(store, t);
      if (found !== null) {
        choice = found;
        logger.info(
          `No Claude integration was recorded in ${configPathFor(store)}. Found ` +
            `${found.hook ? 'the skills and the guard hook' : 'the skills and no guard hook'} ` +
            'in this project, and recorded that.'
        );
      }
    }
  }

  if (choice !== null && choice !== undefined) {
    for (const { file, render } of claudeSkills(store, t)) {
      write(file, render());
      logger.info(`Wrote ${file}.`);
    }
    // In a session started in a parent directory, Claude Code finds a project's skills only after
    // the session has read a file inside the project. /jtrek-start, which is the first thing a
    // session runs, is therefore missing in such a session, as R-000161 found. The owner chose to
    // warn about this rather than install the skills anywhere else, because a second copy outside
    // the project would need its own upkeep.
    logger.warn(
      `Start Claude Code sessions in ${store.projectRoot}. In a session started above it, ` +
        '/jtrek-start is not available until the session has read a file in the project.'
    );

    if (choice.hook) {
      const what = installHook(t.settingsFile);
      logger.info(`Hook ${what} in ${t.settingsFile} — commit it so the guard is visible in review.`);
      if (!args.userHook && hookState(userSettingsPath()).status !== 'current') {
        logger.info(
          `Claude Code reads that file only in a session started in ${store.projectRoot}, so the ` +
            'guard does not run in a session started above it. Pass --user-hook to run it in ' +
            'every session on this machine.'
        );
      }
      // The tools instruction is installed with the hook and never without it. It exists to make
      // clear which writes the hook covers, so in a project with no hook it would serve no purpose.
      write(t.toolsRuleFile, renderToolsRule(store));
      logger.info(`Wrote ${t.toolsRuleFile}, which tells Claude Code to write the store with the tools the guard sees.`);
    } else {
      logger.info('No guard hook, as this project recorded. Drop --no-hook to install one.');
    }

    const configPath = writeChoice(store, choice);
    logger.info(`Recorded the Claude integration in ${configPath}, so a later install repeats it.`);
  } else {
    logger.info(
      'Nothing Claude-specific is installed. Pass --claude for the session skills and a hook ' +
        'that refuses direct writes to registry.ndjson.'
    );
  }

  // The user-level hook is not recorded in jtrek.json. That file is committed and shared, while
  // this hook belongs to one machine. Recording it would make a reinstall without flags on a
  // colleague's machine write into that colleague's home directory without being asked to.
  if (args.userHook) {
    const userSettings = userSettingsPath();
    const what = installHook(userSettings);
    logger.info(
      `Hook ${what} in ${userSettings}. It runs in every Claude Code session on this machine, ` +
        'wherever the session starts, and does nothing where there is no jtrek store.'
    );
  }

  removeWhatEarlierVersionsLeft(store, t);

  // This is the part of the R-0043 fix that runs at install time. Writing a hook whose command
  // cannot be found used to be reported as a success, and the hook then allowed every edit without
  // any message.
  const hookFiles = [];
  if (choice?.hook) hookFiles.push(t.settingsFile);
  if (args.userHook) hookFiles.push(userSettingsPath());
  if (hookFiles.length > 0 && commandOnPath(GUARD_EXECUTABLE) === null) {
    for (const settingsPath of hookFiles) logger.warn(unresolvedGuardMessage(settingsPath));
  }

  return 0;
}

/**
 * Returns every instruction file that holds a pointer. A file with two names linked to it is
 * counted once.
 */
function blocksInPlace(t) {
  return t.instructionFiles
    .map((file) => ({ file, text: readIfPresent(file) }))
    .filter((entry) => entry.text !== null)
    .map((entry) => ({ ...entry, block: extractBlock(entry.text) }))
    .filter((entry) => entry.block !== null);
}

/**
 * Returns every problem that `--check` would report, as plain sentences.
 *
 * It is exported, and kept separate from the logging, so that another command can ask whether this
 * gate would pass without running a shell command or printing anything. `jtrek start` lists each
 * problem among the blockers that stop a session from taking new work.
 */
export function instructionProblems(store, { instructions = null } = {}) {
  const t = targets(store, { instructions });
  const problems = [];
  const block = renderBlock(store);

  // Every instruction file must carry a current pointer. A pointer is not a copy of the rules, so
  // several pointers cannot disagree with each other. Having more than one is therefore correct and
  // not a sign of drift. The failure worth catching is an instruction file that has no pointer.
  for (const file of t.instructionFiles) {
    const text = readIfPresent(file);
    const installed = text === null ? null : extractBlock(text);
    if (installed === null) problems.push(`${file} has no jtrek pointer.`);
    else if (installed !== block) {
      problems.push(`The jtrek pointer in ${file} does not match the installed jtrek.`);
    }
  }

  // `t.planDoc`, `t.specDoc`, `t.handoffFile` and `t.codingStandardsFile` are deliberately left out
  // of this list. All four hold the project's own prose, so there is nothing to compare them against. A gate that failed
  // whenever somebody edited the plan or closed a session would teach people to stop reading the
  // gate's output. The requirements rendered in the spec are compared by `jtrek build --check`.
  for (const { file, render } of regeneratedDocs(store, t)) {
    const text = readIfPresent(file);
    if (text === null) problems.push(`${file} does not exist.`);
    else if (text !== render()) {
      problems.push(`${file} does not match the installed jtrek.`);
    }
  }

  // What the project recorded decides how strict this check is. R-0034 made that possible by
  // writing the choice into jtrek.json. For a project that recorded nothing, a file is compared
  // only if it is present. A missing file is then the project's choice, and a gate that demanded
  // the file would fail every project that chose to go without. For a project that recorded the
  // Claude Code integration, a missing file is also reported, because the project opted into that
  // file and has lost it.
  const chose = recordedChoice(store);

  for (const { file, render } of claudeSkills(store, t)) {
    const text = readIfPresent(file);
    if (text === null) {
      if (chose !== null) problems.push(`${file} is missing, and this project records it.`);
    } else if (text !== render()) {
      problems.push(`${file} does not match the installed jtrek.`);
    }
  }

  // The guard runs on every file edit. A project that relies on its refusals should therefore be
  // told when the hook that runs is not the one jtrek installed.
  const hook = hookState(t.settingsFile);
  if (hook.status === 'stale') {
    problems.push(`jtrek's hooks in ${t.settingsFile}, the guard and the threshold hook, do not match the installed jtrek.`);
  } else if (hook.status === 'unreadable') {
    problems.push(`${t.settingsFile} is not valid JSON, so the guard hook cannot be checked: ${hook.why}`);
  } else if (hook.status === 'absent' && chose?.hook === true) {
    problems.push(`The guard hook is missing from ${t.settingsFile}, and this project records it.`);
  }

  // The tools instruction follows the hook. It is required where the project records the hook, and
  // it is compared wherever it is present.
  const toolsRule = readIfPresent(t.toolsRuleFile);
  if (toolsRule === null) {
    if (chose?.hook === true) problems.push(`${t.toolsRuleFile} is missing, and this project records the guard hook.`);
  } else if (toolsRule !== renderToolsRule(store)) {
    problems.push(`${t.toolsRuleFile} does not match the installed jtrek.`);
  }

  for (const { path: file, what } of formerLeftovers(store, t)) {
    problems.push(`${file} holds ${what}, which jtrek no longer uses.`);
  }

  // The opposite case is deliberately not reported. That case is a hook that is present while the
  // project recorded 'hook': false. It is not drift in jtrek's output, because jtrek did not
  // write it. The remedy that the gate names could not fix it either, because `install` only ever
  // writes files, and nothing it can be told to do removes a hook. A gate that fails while naming a
  // remedy that cannot fix the problem is the very defect R-0034 recorded. Building a second such
  // gate just for symmetry would be a poor trade. Somebody who adds the guard by hand has made a
  // choice that jtrek was not asked about.

  return problems;
}

function check(store, args) {
  const problems = instructionProblems(store, { instructions: args.instructions });
  const unresolved = guardCommandProblem(store);

  if (problems.length === 0 && unresolved === null) {
    logger.info('The agent instructions match the installed jtrek.');
    return 0;
  }
  for (const problem of problems) logger.error(problem);
  if (problems.length > 0) logger.error("Run 'jtrek agent install' and commit the result.");
  if (unresolved !== null) logger.error(unresolved);
  return 1;
}

/**
 * Removes everything that `install` wrote, and nothing else.
 *
 * The store is deliberately left alone. `registry.ndjson`, `records/`, `registry.md` and
 * `work.json` are the work itself, while the files removed here are the instructions for operating
 * on it. An uninstall that removed both could destroy months of history
 * in order to undo a documentation change.
 *
 * `jtrek_plan.md` and `jtrek_spec.md` are left alone for the same reason, even though `install`
 * created them. What `install` wrote was an empty starting template. What is there now is the
 * project's own planning, and removing the tool is not a reason to delete it.
 */
function uninstall(args, store) {
  const t = targets(store, { instructions: args.instructions });
  const done = [];
  const act = (description, apply) => {
    done.push(description);
    if (!args.dryRun) apply();
  };

  // Every candidate instruction file is cleaned, deliberately ignoring any --instructions setting
  // that would limit the list. A project may have gained a CLAUDE.md, or removed a symbolic link,
  // after the pointer was installed. A pointer left behind in a file that the current settings would
  // not target is exactly the kind of out-of-date instruction that should be removed.
  const sweep = targets(store);
  const files = new Set([...sweep.instructionFiles, ...t.instructionFiles]);

  for (const { file, text } of blocksInPlace({ instructionFiles: [...files] })) {
    const stripped = removeBlock(text);
    if (stripped === null) continue;

    const description = isLeftEmpty(stripped)
      ? `remove ${file} (it held nothing but the jtrek block)`
      : `remove the jtrek block from ${file}`;
    act(description, () => writeWithoutBlock(file, stripped));
  }

  // `legacyDocs` is in this list because a project installed before those documents were renamed
  // or replaced may still have them on disk, if `install` has not run since. `t.handoffFile` and
  // `t.codingStandardsFile` are not in this list, for the same reason that `jtrek_plan.md` is not.
  // What `install` wrote was a starting template, and what is there now is the project's own
  // writing: its record of where its work stands, or its own coding standards.
  for (const filePath of [
    ...regeneratedDocs(store, t).map(({ file }) => file),
    ...t.legacyDocs,
    ...claudeSkills(store, t).map(({ file }) => file),
    t.toolsRuleFile,
  ]) {
    if (!fs.existsSync(filePath)) continue;
    act(`remove ${filePath}`, () => removeFileAndEmptyDirs(filePath, store.projectRoot));
  }

  const settingsText = readIfPresent(t.settingsFile);
  if (settingsText !== null) {
    const settings = JSON.parse(settingsText);
    if (removeHook(settings)) {
      act(`remove the guard hook from ${t.settingsFile}`, () =>
        fs.writeFileSync(t.settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
      );
    }
  }

  // The user-level hook serves every project on the machine, so it is removed only when the user
  // asks for that.
  if (args.userHook) {
    const userSettings = userSettingsPath();
    const userText = readIfPresent(userSettings);
    if (userText !== null) {
      const settings = JSON.parse(userText);
      if (removeHook(settings)) {
        act(`remove the guard hook from ${userSettings}`, () =>
          fs.writeFileSync(userSettings, `${JSON.stringify(settings, null, 2)}\n`)
        );
      }
    }
  }

  // The key is removed, but the file is not. `jtrek.json` belongs to the project, and it also says
  // where the store is. An uninstall therefore takes out what `install` wrote into it and leaves the
  // rest, exactly as it does with the settings file above.
  const configPath = configPathFor(store);
  const configText = readIfPresent(configPath);
  if (configText !== null) {
    const config = JSON.parse(configText);
    if (removeChoice(config)) {
      act(`remove the recorded Claude integration from ${configPath}`, () =>
        fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
      );
    }
  }

  if (done.length === 0) {
    logger.info('Nothing to remove — jtrek has written nothing into this project.');
    return 0;
  }

  for (const description of done) {
    logger.info(`${args.dryRun ? 'would ' : ''}${description}`);
  }
  logger.info(
    args.dryRun
      ? `${done.length} change(s) would be made. Re-run without --dry-run to apply them.`
      : `${done.length} change(s) made. The store was not touched.`
  );
  return 0;
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.install) return install(args, store);
  if (args.uninstall) return uninstall(args, store);
  return check(store, args);
}
