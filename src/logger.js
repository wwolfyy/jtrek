/**
 * src/logger.js creates loggers. Each module creates its own, following the repository's
 * convention of one logger per module.
 *
 * Log messages go to stderr, and data goes to stdout. A command such as
 * `jtrek query --query … | jq` therefore passes only the data through the pipe, with no log lines
 * mixed into it.
 */

export function createLogger(name) {
  const write = (level, message) => process.stderr.write(`[${name}] ${level} ${message}\n`);
  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
  };
}
