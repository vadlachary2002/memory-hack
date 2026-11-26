// CLI adapter. Reads JSON files, calls the Memory library, prints results.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { startServer } from './adapters/http.js';
import { dbPath } from './config.js';
import { FixtureSchema, loadFixture } from './fixture.js';
import { GeminiClient } from './llm/gemini.js';
import { createClient, keyFor } from './llm/provider.js';
import { Memory } from './memory.js';
import { renderLine } from './render.js';
import { SessionInputSchema } from './types.js';

const USAGE = `usage:
  cli reset                            drop and recreate the database
  cli load <fixture.json>              replay a hand-written fact fixture (no model)
  cli ingest <sessions.json> [--until N]  ingest sessions through extraction (model call per session)
  cli say "<message>"                  send one chat message as a new session (model call)
  cli facts                            list every fact row, erased included
  cli ask "<question>" [--at N]        answer from memory as of session N (two model calls at most)
  cli summary [session]                render the profile, or one session
  cli forget "<name or relation>"     erase a person (name, alias, or words like "my ex") and self-audit
  cli audit "<name>"                   scan every text column for a name; passes when nothing is found
  cli cost                             model calls and spend so far
  cli models                           list the Gemini model ids your GEMINI_API_KEY can use
  cli serve [--port N]                 HTTP adapter: POST /ingest /ask /forget /reset, GET /summary /audit /cost
set TRACE=1 to print one line per decision`;

const SessionsFileSchema = z.array(SessionInputSchema);

loadDotEnv();
main(process.argv.slice(2)).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

async function main(args: readonly string[]): Promise<void> {
  const [command, arg, ...rest] = args;
  const memory = new Memory({ dbPath: dbPath(), llm: createClient() });
  const nameOf = (id: number): string => memory.nameOf(id);

  switch (command) {
    case 'reset': {
      memory.reset();
      console.log(`reset ${dbPath()}`);
      return;
    }
    case 'load': {
      if (arg === undefined) return fail('load needs a fixture path');
      const fixture = FixtureSchema.parse(JSON.parse(readFileSync(arg, 'utf8')));
      const report = loadFixtureInto(memory, fixture);
      console.log(report);
      return;
    }
    case 'ingest': {
      if (arg === undefined) return fail('ingest needs a sessions file');
      const until = optionValue(rest, '--until');
      const sessions = SessionsFileSchema.parse(JSON.parse(readFileSync(arg, 'utf8'))).filter(
        (session) => until === undefined || session.index <= until,
      );
      const skipped = sessions.filter((session) => memory.hasSession(session.index)).map((session) => session.index);
      if (skipped.length > 0) console.log(`skipping ${skipped.length} session(s) already ingested: s${skipped[0]}..s${skipped[skipped.length - 1]}`);
      for (const session of sessions) {
        if (memory.hasSession(session.index)) continue;
        const report = await memory.ingest(session);
        const rejected = report.rejected.map((item) => `${item.reason}: ${item.candidate}`).join('; ');
        const forgotten = report.forgotten
          .map((item) => `entities ${item.entityIds.join(',') || '-'} erased ${item.erasedFacts.length} stripped ${item.strippedFacts.length} redacted ${item.redactedTurns.length} scan ${item.scanClean ? 'clean' : 'HITS'}`)
          .join('; ');
        console.log(
          `s${report.session}: stored ${report.stored.length}, superseded ${report.superseded.length}, tainted ${report.tainted}, forgotten ${report.forgotten.length}, cost $${report.cost.toFixed(4)}` +
            (rejected === '' ? '' : `\n  rejected ${rejected}`) +
            (forgotten === '' ? '' : `\n  FORGET ${forgotten}`),
        );
      }
      return;
    }
    case 'say': {
      if (arg === undefined) return fail('say needs a message');
      const index = memory.latestSession() + 1;
      const report = await memory.ingest({ index, turns: [{ role: 'user', text: arg }] });
      const facts = report.stored.map((id) => memory.facts(true).find((fact) => fact.id === id)).filter((fact) => fact !== undefined);
      console.log(`s${index}: stored ${report.stored.length}, superseded ${report.superseded.length}, tainted ${report.tainted}, forgotten ${report.forgotten.length}, cost $${report.cost.toFixed(4)}`);
      for (const fact of facts) console.log(`  + ${renderLine(fact, nameOf)}`);
      for (const item of report.rejected) console.log(`  rejected ${item.reason}: ${item.candidate}`);
      for (const item of report.forgotten) console.log(`  FORGET entities ${item.entityIds.join(',') || '-'} erased ${item.erasedFacts.length} scan ${item.scanClean ? 'clean' : 'HITS'}`);
      return;
    }
    case 'ask': {
      if (arg === undefined) return fail('ask needs a question');
      const asOf = optionValue(rest, '--at');
      const result = await memory.ask(arg, asOf === undefined ? {} : { asOf });
      console.log(result.text);
      console.log(
        `  domains ${result.domains.join(',')}  candidates ${result.candidates.length}  cited ${result.cited.map((id) => `f${id}`).join(',') || '-'}  ${result.abstained ? 'abstained' : 'answered'}  $${result.cost.toFixed(4)}`,
      );
      return;
    }
    case 'facts': {
      for (const fact of memory.facts(true)) {
        const state = fact.erasedAt !== null ? 'erased' : fact.validTo === null ? 'open' : 'closed';
        console.log(`${String(fact.id).padStart(3)} ${state.padEnd(6)} ${fact.tier.padEnd(7)} ${renderLine(fact, nameOf)}`);
      }
      return;
    }
    case 'summary': {
      console.log(memory.summarise(arg === undefined ? {} : { session: Number(arg) }));
      return;
    }
    case 'forget': {
      if (arg === undefined) return fail('forget needs a name or relation');
      const report = memory.forget({ kind: 'entity', name: arg });
      console.log(
        `entities ${report.entityIds.join(',') || '-'}  erased facts ${report.erasedFacts.length}  stripped ${report.strippedFacts.length}  redacted turns ${report.redactedTurns.length}`,
      );
      for (const probe of report.probes) console.log(`  probe ${probe.name.padEnd(18)} ${probe.passed ? 'pass' : 'FAIL'}`);
      console.log(`  scan ${report.scanClean ? 'clean' : 'HITS FOUND'}`);
      return;
    }
    case 'audit': {
      if (arg === undefined) return fail('audit needs a name');
      const report = memory.audit(arg);
      console.log(
        `facts ${report.factHits.length}  turns ${report.turnHits.length}  entities ${report.entityHits.length}  summary ${report.summaryHit ? 'hit' : 'clean'}  => ${report.clean ? 'PASS' : 'FAIL'}`,
      );
      return;
    }
    case 'serve': {
      const port = optionValue([arg ?? '', ...rest], '--port') ?? 3000;
      const server = await startServer(memory, port);
      const address = server.address();
      console.log(`listening on port ${typeof address === 'object' && address !== null ? address.port : port}`);
      return;
    }
    case 'models': {
      const key = keyFor('gemini');
      if (key === undefined) return fail('GEMINI_API_KEY is not set');
      for (const name of await new GeminiClient(key).listModels()) console.log(name);
      return;
    }
    case 'cost': {
      const report = memory.cost();
      for (const [purpose, cost] of Object.entries(report.byPurpose)) {
        console.log(`${purpose.padEnd(9)} calls ${cost.calls}  in ${cost.inputTokens}  out ${cost.outputTokens}  $${cost.usd.toFixed(4)}`);
      }
      console.log(`total     calls ${report.calls}  $${report.usd.toFixed(4)}`);
      return;
    }
    default:
      return fail(USAGE);
  }
}

function loadFixtureInto(memory: Memory, fixture: z.infer<typeof FixtureSchema>): string {
  const report = loadFixture(memory.rawDb(), fixture);
  return `inserted ${report.inserted.length}, superseded ${report.superseded.length}, closed ${report.closed.length}, no-ops ${report.noops}`;
}

function optionValue(args: readonly string[], name: string): number | undefined {
  const at = args.indexOf(name);
  const value = at === -1 ? undefined : args[at + 1];
  return value === undefined ? undefined : Number(value);
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file; environment variables may still be set.
  }
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}
