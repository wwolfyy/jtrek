/**
 * src/commands/view.js implements `jtrek view`, which serves the store as a page for reading in a
 * browser.
 *
 * This command writes nothing anywhere: no `work.json`, no `registry.db` and no temporary file. It
 * is `jtrek query` with a browser in front of it. It therefore sits entirely outside the check-out
 * and check-in loop, and it can be left running while a checkout is open.
 *
 * It is a server rather than a generated file for the following reason. `jtrek build` and
 * `jtrek db` both write a copy of the store to disk, and both copies go out of date the moment
 * `jtrek checkin` appends a row. A lookup tool that silently shows the previous revision of a
 * record is worse than no tool. This one therefore reads `registry.ndjson` again on every request.
 * Rebuilding the index takes milliseconds at this store's size, which is the same argument
 * `openStore` already makes for rebuilding it once per command run.
 *
 * Each request also reads the store through a new Node process, so that it runs the jtrek source
 * currently on disk rather than the source this server started with. Node loads a module only
 * once. A server that called `readStore` in its own process therefore kept the validator it had
 * when it started. The schema then changed twice: `related` became an object (`R-000151`), and the
 * version header and the `chain` field arrived (`R-0036`). Each time, the long-running server
 * refused every row that the current jtrek writes, and the page showed nothing but that refusal
 * until someone restarted the server (`R-000152`, `R-000159`). A child process costs roughly one
 * Node start-up per request, and the page makes one such request each time it loads.
 *
 * It reads `registry.ndjson` through `src/store.js`, and never reads `registry.db`. That file is a
 * copy for a database browser, and nothing in the tool may read it back, as `commands/db.js`
 * explains. Going through the shared loader also means that this page and `jtrek query` can never
 * disagree about what the store says.
 *
 * It listens only on the loopback interface. The store holds a project's unpublished working
 * notes. `selectByQuery` also inserts its predicate directly into SQL, on the stated grounds that
 * nothing reaches it from a network. No route here accepts a predicate, and listening only on the
 * loopback interface keeps that assumption true.
 *
 * Usage:
 *   jtrek view                  serve on 127.0.0.1:7391
 *   jtrek view --port 8080      serve on another port
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dashboard } from '../dashboard.js';
import { UsageError } from '../errors.js';
import { createLogger } from '../logger.js';
import { PLAN_FILENAME } from '../plan.js';
import { currentRecords, openStore, revisionsOf } from '../store.js';
import { readText } from '../text.js';

const logger = createLogger('jtrek/view');

const DEFAULT_PORT = 7391;
const HOST = '127.0.0.1';
const PAGE_PATH = path.resolve(import.meta.dirname, 'view.html');
// The store is sent whole. Its JSON is several times the size of registry.ndjson, because every
// record carries all of its revisions. spawnSync's default limit of 1 MiB would cut it short.
const CHILD_MAX_BUFFER = 512 * 1024 * 1024;

export const USAGE = `
Usage:
  jtrek view [--port <number>]

Serves the store at http://${HOST}:${DEFAULT_PORT} for reading in a browser. Every request
re-reads registry.ndjson, so the page is never stale. Writes nothing; Ctrl-C to stop.
`.trim();

export function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--port':
        if (!value) throw new UsageError('--port needs a port number, e.g. --port 8080');
        args.port = Number(value);
        if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
          throw new UsageError(`'${value}' is not a port number between 1 and 65535.`);
        }
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
  return args;
}

/**
 * This returns the whole store as one payload: every record's current revision, each carrying all
 * of its revisions under `revisions`.
 *
 * The page needs every revision's note in order to search across them. The store is small enough
 * that sending all of it once is better than one request per record. `allowMissing` is set for the
 * same reason `jtrek db` sets it: an empty store is a legitimate thing to open.
 */
export function readStore(registryPath) {
  const { db } = openStore({ registryPath, allowMissing: true });
  try {
    const records = currentRecords(db).map((record) => ({
      ...record,
      revisions: revisionsOf(db, record.id),
    }));
    return { records, revisionCount: records.reduce((n, r) => n + r.revisions.length, 0) };
  } finally {
    db.close();
  }
}

/**
 * This returns what the dashboard tab shows, computed by `src/dashboard.js` from the current
 * revision of every record and from the plan document. A store with no plan document is not an
 * error here, because only the dashboard's plan progress needs one.
 */
export function readDashboard(registryPath, planPath) {
  const { db } = openStore({ registryPath, allowMissing: true });
  let records;
  try {
    records = currentRecords(db);
  } finally {
    db.close();
  }
  const planText = fs.existsSync(planPath) ? readText(planPath) : null;
  return dashboard(records, planText, planPath);
}

/**
 * This calls one of this module's exported read functions in a new Node process, which loads the
 * jtrek source from disk again, and returns what it returned.
 *
 * The child process prints the result as JSON on stdout. On failure it prints only the error's
 * message on stderr. The error that reaches the page is therefore the same sentence that a read in
 * this process would have thrown, naming the field and the line of `registry.ndjson` that was
 * refused.
 */
function callFresh(name, args) {
  const script = [
    `import { ${name} } from ${JSON.stringify(pathToFileURL(import.meta.filename).href)};`,
    'try {',
    `  process.stdout.write(JSON.stringify(${name}(...process.argv.slice(1))));`,
    '} catch (error) {',
    '  process.stderr.write(error.message);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n');

  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script, ...args],
    { encoding: 'utf8', maxBuffer: CHILD_MAX_BUFFER }
  );
  if (child.error) {
    logger.error(`Could not start a process to run ${name}: ${child.error.message}`);
    throw child.error;
  }
  if (child.status !== 0) {
    throw new Error(child.stderr.trim() || `Reading the store exited with status ${child.status}.`);
  }
  return JSON.parse(child.stdout);
}

/** This runs `readStore` in a new Node process, as `callFresh` describes. */
export function readStoreFresh(registryPath) {
  return callFresh('readStore', [registryPath]);
}

/** This runs `readDashboard` in a new Node process, as `callFresh` describes. */
export function readDashboardFresh(registryPath, planPath) {
  return callFresh('readDashboard', [registryPath, planPath]);
}

/**
 * This returns a record's prose file. It returns null when the id is malformed, or when no file
 * exists at the path built from it.
 *
 * The path is built from the record's id rather than taken from `detail_ref`. A malformed or
 * hostile value in the registry therefore cannot point at a file outside `records/`.
 */
export function readProse(recordsDir, id) {
  // The id must be `R-` followed by at least four digits and nothing else. Ids are not all the same
  // width, because jtrek pads new ones to six digits and a store keeps whatever width its earlier
  // records were written at.
  if (!/^R-\d{4,}$/.test(id)) return null;
  const file = path.join(recordsDir, `${id}.md`);
  try {
    return readText(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    logger.error(`Could not read ${file}: ${error.message}`);
    throw error;
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * This is the request handler. It is kept separate from the server so that a test can drive it
 * without a socket.
 *
 * It answers four routes and nothing else: the page, the store, the dashboard, and one record's
 * prose.
 */
export function createHandler(store) {
  return function handle(request, response) {
    const url = new URL(request.url, `http://${HOST}`);

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'This server only answers GET; it writes nothing.' });
      return;
    }

    try {
      if (url.pathname === '/') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(fs.readFileSync(PAGE_PATH, 'utf8'));
        return;
      }

      if (url.pathname === '/api/store') {
        const { records, revisionCount } = readStoreFresh(store.registryPath);
        sendJson(response, 200, {
          storeDir: store.dir,
          readAt: new Date().toISOString(),
          recordCount: records.length,
          revisionCount,
          records,
        });
        return;
      }

      if (url.pathname === '/api/dashboard') {
        const planPath = path.join(store.dir, PLAN_FILENAME);
        sendJson(response, 200, readDashboardFresh(store.registryPath, planPath));
        return;
      }

      if (url.pathname === '/api/prose') {
        const id = url.searchParams.get('id') ?? '';
        const text = readProse(store.recordsDir, id);
        sendJson(response, text === null ? 404 : 200, { id, text });
        return;
      }

      sendJson(response, 404, { error: `No such path: ${url.pathname}` });
    } catch (error) {
      logger.error(`${request.method} ${url.pathname} failed: ${error.message}`);
      sendJson(response, 500, { error: error.message });
    }
  };
}

export function run(argv, store) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  // Loading the store once before the socket opens turns a broken store into a failure at start-up,
  // rather than an error page. `jtrek db` makes the same trade by rebuilding from scratch.
  const { records, revisionCount } = readStore(store.registryPath);

  const server = http.createServer(createHandler(store));

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${args.port} is already in use. Try 'jtrek view --port <other>'.`);
    } else {
      logger.error(`The server could not start: ${error.message}`);
    }
    process.exitCode = 1;
    server.close();
  });

  server.listen(args.port, HOST, () => {
    logger.info(`${records.length} record(s), ${revisionCount} revision(s) in ${store.dir}`);
    logger.info(`Reading at http://${HOST}:${args.port} — writes nothing. Ctrl-C to stop.`);
  });

  process.on('SIGINT', () => {
    logger.info('Stopping.');
    server.close(() => process.exit(0));
  });

  return 0;
}
