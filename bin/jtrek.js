#!/usr/bin/env node

/**
 * bin/jtrek.js is the tool's only executable.
 *
 * It finds the store once and then passes the remaining arguments to a command. Commands never
 * find the store themselves. There is therefore exactly one place that decides which store a
 * command operates on, and exactly one place to change if that decision changes.
 *
 * Exit codes carry meaning, because a person, an agent following the closing procedure, or a
 * script reads the result of a gate from its exit code. The codes are 0 on success, 2 when the
 * invocation itself is wrong, and 1 on every other failure. `R-0024` introduced the distinction
 * between 2 and 1, and `src/errors.js` explains it. The `catch` at the bottom of this file applies
 * the mapping, and it is the only place from which an exit code of 2 can come.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findStore } from '../src/discovery.js';
import { UsageError, USAGE_EXIT } from '../src/errors.js';
import { createLogger } from '../src/logger.js';
import * as init from '../src/commands/init.js';
import * as migrate from '../src/commands/migrate.js';
import * as migrateFromJtrack from '../src/commands/migrate-from-jtrack.js';
import * as build from '../src/commands/build.js';
import * as checkin from '../src/commands/checkin.js';
import * as checkout from '../src/commands/checkout.js';
import * as query from '../src/commands/query.js';
import * as history from '../src/commands/history.js';
import * as db from '../src/commands/db.js';
import * as view from '../src/commands/view.js';
import * as check from '../src/commands/check.js';
import * as handoff from '../src/commands/handoff.js';
import * as start from '../src/commands/start.js';
import * as agent from '../src/commands/agent.js';
import * as guard from '../src/commands/guard.js';
import * as threshold from '../src/commands/threshold.js';
import * as plan from '../src/commands/plan.js';
import * as crossReview from '../src/commands/cross-review.js';

const logger = createLogger('jtrek');

const COMMANDS = {
  // Store discovery must not run before `init`. Discovery throws an error when there is no store,
  // and having no store is exactly the situation `init` exists for. `init` finds its own target,
  // and it refuses to overwrite a store it finds there.
  init: { run: init.run, summary: 'adopt the store already here, or create one', needsStore: false },
  // Every other command reads the store through `openStore`, which refuses a store at a different
  // format version. `migrate` is therefore the one command that a project can still run when its
  // store has stopped loading.
  migrate: { run: migrate.run, summary: 'rebuild the store against the current schema' },
  start: { run: start.run, summary: 'gather the facts needed to decide what to work on' },
  checkout: { run: checkout.run, summary: 'take records into work.json, to be worked on' },
  query: { run: query.run, summary: 'read records without taking them; writes nothing' },
  history: { run: history.run, summary: 'read every revision of a record; writes nothing' },
  view: { run: view.run, summary: 'browse the store in a browser; writes nothing' },
  checkin: { run: checkin.run, summary: 'append the changed records to the registry' },
  build: { run: build.run, summary: 'regenerate registry.md, registry.db and the spec requirements' },
  check: { run: check.run, summary: 'verify the registry was appended to and never altered' },
  db: { run: db.run, summary: 'regenerate registry.db only' },
  handoff: { run: handoff.run, summary: 'gather the facts needed to write the hand-off' },
  plan: {
    run: plan.run,
    summary: 'check plan values against the plan, print the draft spec, or report each section\'s progress',
  },
  'cross-review': { run: crossReview.run, summary: 'start the cross-family reviewer of a finished feature or plan section' },
  agent: { run: agent.run, summary: 'install or verify the agent instructions' },
  // The guard finds its own store from the working directory given in the hook's input. Where there
  // is no store at all, it must exit without output. Running discovery here would throw an error in
  // that case, which would defeat the guard.
  guard: { run: guard.run, summary: 'hook entry point; refuses direct writes to the registry', needsStore: false },
  // Like the guard, it finds its own store from the hook's input, and it fails open without one.
  threshold: { run: threshold.run, summary: 'hook entry point; tells a session it crossed a threshold', needsStore: false },
};

const USAGE = `
jtrek — a version-controlled, append-only work store.

Usage: jtrek <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, command]) => `  ${name.padEnd(10)} ${command.summary}`)
  .join('\n')}

The loop is: checkout → edit work.json → checkin → build.

The store is found by walking up from the working directory, looking for a 'store' key in a
jtrek.json and then for a jtrek/ directory holding registry.ndjson.
JTREK_STORE overrides it, and 'jtrek init' settles it.

Options:
  --help, -h      this message, or a command's own help when it follows a command
  --version, -v   print the version
`.trim();

function version() {
  const packagePath = path.resolve(import.meta.dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
}

function main(argv) {
  const [name, ...rest] = argv;

  // Asking for help is a success. Invoking the tool with no command at all is a usage error, and
  // R-0024 changed its exit code from 1 to 2 along with the other usage errors. Both cases print
  // the same page, because a caller who named no command needs to read the list of commands.
  if (!name || name === '--help' || name === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return name ? 0 : USAGE_EXIT;
  }
  if (name === '--version' || name === '-v') {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const command = COMMANDS[name];
  if (!command) {
    throw new UsageError(`Unknown command '${name}'.\n\n${USAGE}`);
  }

  // Asking a command for its help text must not require a store. Store discovery is the only step
  // between here and the command that can fail, so `--help` is answered before discovery runs.
  if (rest.includes('--help') || rest.includes('-h')) {
    return command.run(['--help'], {});
  }

  if (command.needsStore === false) return command.run(rest);

  // `jtrek migrate --from-jtrack` exists for projects that still use the names the tool had while
  // it was called jtrack. Discovery refuses exactly those projects, so this one form of the command
  // runs without a store and finds the project itself.
  if (name === 'migrate' && rest.includes('--from-jtrack')) return migrateFromJtrack.run(rest);

  const store = findStore();
  return command.run(rest, store);
}

// This is the only place that produces an exit code of 2. A usage error is recognised by its type
// rather than by its message, so an error thrown as a plain `Error` cannot produce 2, however it is
// worded.
//
// An error that escapes a command must continue to produce exit code 1, because of `jtrek guard`.
// The guard runs as a Claude Code `PreToolUse` hook, and for such a hook an exit code of 2 means
// "block the tool call". The guard promises that any unexpected failure lets the call through.
// `guard.js` catches only three kinds of failure itself: reading stdin, `JSON.parse` and
// `findStore`. Anything else thrown inside its `run` arrives here, and the call goes through only
// because this code returns something other than 2. `R-0025` rev 3 recorded that the guard's main
// promise is kept by a file the guard does not own.
try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  logger.error(error.message);
  process.exitCode = error instanceof UsageError ? USAGE_EXIT : 1;
}
