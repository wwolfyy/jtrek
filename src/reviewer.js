/**
 * src/reviewer.js starts another lab's command-line agent as the cross-family reviewer, hands it an
 * instruction, and returns the report it gives back.
 *
 * `jtrek cross-review` decides what the reviewer reads, and this module decides how each supported
 * agent is started and how its report is read out of what it prints. The two change for different
 * reasons. The instruction changes when the review procedure changes, while the arguments and the
 * output format change when an agent's command-line interface changes, as agy's did (R-000561).
 */

import { spawnSync } from 'node:child_process';
import { startCommand } from './program.js';

/**
 * The supported agents, each with the arguments that run it read-only, without interaction, and
 * reading its instruction from standard input. Gemini CLI runs in interactive mode unless it is
 * given -p, and it appends the text given with -p to what it reads on standard input. A short line
 * pointing at the instruction is therefore passed with -p, and the instruction itself still arrives
 * on standard input (R-000494). The first real review, which `R-000463` holds, confirms these flags
 * against the agents themselves.
 */
const AGENT_ARGS = {
  claude: ['-p', '--permission-mode', 'plan'],
  codex: ['exec', '--sandbox', 'read-only'],
  gemini: ['--approval-mode', 'plan', '-p', 'Follow the instruction above.'],
  agy: ['--input-format', 'stream-json', '--output-format', 'stream-json'],
};

export const SUPPORTED_AGENTS = Object.keys(AGENT_ARGS);

/**
 * The Antigravity CLI, `agy`, does not read plain text on standard input. It reads JSON messages
 * there, one per line, only when its input and its output are both `stream-json`, and it then
 * reports as a stream of JSON events, one per line, ending with a `result` event that carries a
 * status and the whole response (R-000561, R-000562). It runs without `--mode`, because in plan mode
 * it answers every request with a plan to approve rather than with a review. Without a terminal and
 * without `--mode`, it reads files but refuses every tool action that would need permission, such
 * as writing a file or running a command, which keeps it read-only. A refusal can leave the
 * response empty while the status is still SUCCESS and the exit code still 0, so an empty response
 * is treated as a failure (R-000563). The owner's probes of agy 1.4.7 on 2026-10-25 established each
 * of these points, and `R-000463` records them.
 *
 * The agents not listed here read the instruction as plain text and print the report as it is.
 */
const AGENT_STREAMS = {
  agy: {
    input: (instruction) => `${JSON.stringify({ event: 'user', message: { content: instruction } })}\n`,
    report: agyReport,
    failure: agyFailure,
  },
};

// A reviewer's report can be long, and agy prints every event of its run before the report. The
// default limit of `spawnSync` is one megabyte, beyond which it fails.
const MAX_OUTPUT = 256 * 1024 * 1024;

/**
 * Parses one line of agy's output as an event. A line that is not a JSON object is refused rather
 * than skipped, so that output the command cannot read is never dropped without notice (R-000572).
 * A line such as `null`, `7` or an array is valid JSON but is no event, so it is refused too.
 */
function agyEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throw new Error(`The reviewer 'agy' printed a line that is not JSON, so no report was produced: ${line}`, {
      cause: error,
    });
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error(`The reviewer 'agy' printed a line that is not a JSON object, so no report was produced: ${line}`);
  }
  return event;
}

/** Returns the payload of the final `result` event in agy's output, or undefined when there is none. */
function agyResult(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(agyEvent)
    .findLast((event) => event.event === 'result')?.result;
}

/**
 * Returns what the final `result` event says about a run that exited non-zero, or null when agy
 * printed no such event. agy 1.4.7 exits 1 when the status is ERROR, and the reason is only in the
 * event, so without this the command would report the exit code alone (R-000592).
 */
function agyFailure(stdout) {
  const result = agyResult(stdout);
  if (!result) return null;
  return `its result event reported the status ${result.status}${result.error ? `: ${result.error}` : ''}`;
}

/** Returns the response of the final `result` event in agy's output, or throws naming the reviewer. */
function agyReport(stdout) {
  const result = agyResult(stdout);
  if (!result) {
    throw new Error("The reviewer 'agy' ended without a result event, so no report was produced.");
  }
  if (result.status !== 'SUCCESS') {
    throw new Error(
      `The reviewer 'agy' ended with the status ${result.status}` +
        `${result.error ? `: ${result.error}` : ''}, so no report was produced.`
    );
  }
  if (!result.response?.trim()) {
    throw new Error("The reviewer 'agy' returned an empty response, so no report was produced.");
  }
  return result.response;
}

/**
 * Starts the agent `agent`, one of `SUPPORTED_AGENTS`, in the directory `cwd`, asking for the model
 * `model` when one is given, and returns the report it gives for `instruction`. Throws when the agent
 * cannot be started, exits with a failure, or gives no report.
 */
export function runReviewer({ agent, model, instruction, cwd }) {
  const agentArgs = [...AGENT_ARGS[agent], ...(model ? ['--model', model] : [])];
  const stream = AGENT_STREAMS[agent];
  const command = startCommand(agent, agentArgs);
  const result = spawnSync(command.file, command.args, {
    shell: command.shell,
    cwd,
    input: stream ? stream.input(instruction) : instruction,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  if (result.error) {
    throw new Error(`The reviewer '${agent}' could not be started: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const how = result.status === null ? `was stopped by ${result.signal}` : `exited with code ${result.status}`;
    const detail = stream ? stream.failure(result.stdout) : null;
    throw new Error(`The reviewer '${agent}' ${how}${detail ? `, and ${detail}` : ''}, so no report was produced.`);
  }

  return stream ? stream.report(result.stdout) : result.stdout;
}
