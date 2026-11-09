/**
 * src/commands/threshold.js implements `jtrek threshold`, which tells a Claude Code session when it
 * crosses the soft or hard threshold its project set in `jtrek.json`.
 *
 * A threshold is a limit on how much of the context window a session may use, counted in tokens.
 * `rules/session.md` tells a session what to do at each one, but an agent cannot see how much of
 * its context is in use, so it cannot tell when it has reached one. This command runs as a
 * `PostToolUse` hook, which Claude Code starts after every tool call, outside the model. The hook's
 * input names the session's transcript in `transcript_path`. The transcript is a JSONL file, and
 * each model response in it carries a `usage` block. The sum of `input_tokens`,
 * `cache_read_input_tokens` and `cache_creation_input_tokens` in the most recent response is the
 * context in use. `R-0116` records how that was found, and `R-000370` built this command.
 *
 * The owner chose a hook over a check the agent runs itself because it costs fewer tokens. Below
 * the soft threshold this command prints nothing, so it adds nothing to the context. It speaks once
 * when the session crosses the soft threshold and once when it crosses the hard one. A file in the
 * system's temporary directory, named for the session, remembers which thresholds it has already
 * announced. Repeating the message after every later tool call would spend tokens to say again
 * what the session was already told.
 *
 * The command always fails open, as `jtrek guard` does. A missing or unreadable input, no store, a
 * project with no thresholds, a malformed setting or an unreadable transcript all end the command
 * silently with exit code 0. A hook that failed on a surprise would interrupt the session it exists
 * to help, which is worse than a warning that is occasionally missed.
 *
 * Usage: this is not run by hand. `jtrek agent install --claude` installs the hook that runs it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findStore } from '../discovery.js';
import { createLogger } from '../logger.js';

const logger = createLogger('jtrek/threshold');

/**
 * How much of the end of the transcript is read. A transcript grows with the session and can reach
 * many megabytes, and the most recent model response is always near its end. Reading only the tail
 * keeps the hook fast after every tool call.
 */
const TAIL_BYTES = 256 * 1024;

/** What the session is told at each threshold, with the figure and the limit filled in. */
const MESSAGES = {
  soft: (used, limit) =>
    `jtrek: this session has reached its soft threshold (${used} of ${limit} tokens of context ` +
    `in use). Take on nothing new: finish or check in the record in hand. See the session document.`,
  hard: (used, limit) =>
    `jtrek: this session has reached its hard threshold (${used} of ${limit} tokens of context ` +
    `in use). Stop now: append what is done to the prose file, check the record in at ` +
    `in-progress with a note saying where it stopped, rewrite the hand-off's 'Start here' and ` +
    `'Where things stand', run the gates, commit if the owner agrees, and stop. See the session ` +
    `document.`,
};

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Returns the last `bytes` of a file as text. */
function readTail(file, bytes) {
  const handle = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(handle).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Returns the context in use according to the most recent model response in a transcript's text,
 * or null when the text holds no response with a `usage` block.
 *
 * The first line of a tail usually starts partway through a record and does not parse. It is
 * skipped along with any other line that does not parse, because a line the hook cannot read says
 * nothing about the context.
 */
export function contextInUse(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let record;
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const usage = record?.type === 'assistant' ? record.message?.usage : null;
    if (!usage) continue;
    return (
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
    );
  }
  return null;
}

/**
 * Returns the threshold that `used` has reached and not yet been announced, or null.
 *
 * `announced` lists the thresholds already announced in this session. The hard threshold is checked
 * first, so a session that jumps past both in one step is told only the one that applies.
 */
export function thresholdToAnnounce(used, thresholds, announced) {
  if (used >= thresholds.hard && !announced.includes('hard')) return 'hard';
  if (used >= thresholds.soft && used < thresholds.hard && !announced.includes('soft')) return 'soft';
  return null;
}

/** The file that remembers which thresholds were announced in one session. */
function statePath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `jtrek-threshold-${safe}.json`);
}

export function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: jtrek threshold   (reads a PostToolUse hook payload on stdin; not run by hand)\n'
    );
    return 0;
  }

  try {
    const payload = JSON.parse(readStdin());
    if (!payload?.transcript_path || !payload?.session_id) return 0;

    const thresholds = findStore({ cwd: payload.cwd ?? process.cwd() }).config?.thresholds;
    if (!Number.isInteger(thresholds?.soft) || !Number.isInteger(thresholds?.hard)) return 0;

    const used = contextInUse(readTail(payload.transcript_path, TAIL_BYTES));
    if (used === null) return 0;

    const state = statePath(payload.session_id);
    const announced = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : [];
    const which = thresholdToAnnounce(used, thresholds, announced);
    if (!which) return 0;

    fs.writeFileSync(state, JSON.stringify([...announced, which]));
    const figure = (value) => value.toLocaleString('en-US');
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: MESSAGES[which](figure(used), figure(thresholds[which])),
        },
      })}\n`
    );
  } catch (error) {
    // Every failure allows the session to continue, for the reason given at the top of this file.
    // The error is still logged. Claude Code does not show a hook's stderr to the model when the
    // hook exits 0, so the log costs the session no tokens.
    logger.error(`The threshold check was skipped: ${error.stack ?? error.message}`);
  }
  return 0;
}
