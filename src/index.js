/**
 * src/index.js is the library's public interface.
 *
 * The command line tool is a wrapper over this library, and not the other way round. Because the
 * core is a library and the command line tool is only one consumer of it, a later plugin or MCP
 * server could be another consumer without reimplementing anything. The command line tool is
 * nevertheless required rather than merely preferred. The gates have to run from a shell, whether
 * a person runs them or an agent following the closing procedure does, and neither a plugin nor an
 * MCP server can be run from a shell.
 */

export * from './discovery.js';
export * from './store.js';
export { createLogger } from './logger.js';
