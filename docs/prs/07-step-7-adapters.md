# PR title

Step 7: HTTP adapter, trace lines, and the demo script

# PR description

## What this PR builds

The last layer: a second adapter so the library can be reached over HTTP if the hackathon harness wants a service, a trace mode so a judge can watch every decision, and the README demo that walks through all 8 scenarios.

## Read in this order

1. `src/adapters/http.ts`: `node:http` only, no framework. `POST /ingest`, `POST /ask`, `POST /forget`, `POST /reset`, `GET /summary`, `GET /audit`, `GET /cost`, `GET /health`. Bodies are validated with the same zod schemas the library uses, so the HTTP surface cannot drift from the library surface. `npm run cli -- serve --port 3000`.
2. `src/trace.ts` and the three call sites: with `TRACE=1`, ingest prints what was stored, superseded, rejected, tainted and forgotten; ask prints the classification, the selection with candidate ids and any abstain reason, and the citations and cost. One line each, to stderr, so JSON output on stdout stays clean.
3. `README.md`: the demo script in scenario order, the project layout, and the day-of plan.
4. `docs/handoff.md`: updated to "all seven steps built, live run pending".
5. `tests/http.test.ts`: a real server on a free port with the fake client, exercising every route.

## Day-of use

On 28 November the first twenty minutes go to reading their starter repo and picking the adapter that matches: library import, CLI, batch file, or this HTTP server. Each is a thin file over `Memory`, which is the point of having built all of them once.

## How to run

```sh
npm test
TRACE=1 npm run cli -- ask "will it rain tomorrow"     # needs ANTHROPIC_API_KEY
npm run cli -- serve --port 3000
curl -s localhost:3000/health
```
