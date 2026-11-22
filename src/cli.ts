// CLI adapter. Reads JSON files, calls the Memory library, prints results.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { dbPath } from './config.js';
import { FixtureSchema, loadFixture } from './fixture.js';
import { AnthropicClient } from './llm/anthropic.js';
import type { LlmClient } from './llm/client.js';
import { Memory } from './memory.js';
import { renderLine } from './render.js';
import { SessionInputSchema } from './types.js';

const USAGE = `usage:
  cli reset                            drop and recreate the database
  cli load <fixture.json>              replay a hand-written fact fixture (no model)
  cli ingest <sessions.json> [--until N]  ingest sessions through extraction (model call per session)
  cli facts                            list every fact row, erased included
  cli summary [session]                render the profile, or one session
  cli forget "<name or relation>"     erase a person (name, alias, or words like "my ex") and self-audit
  cli audit "<name>"                   scan every text column for a name; passes when nothing is found
  cli cost                             model calls and spend so far`;

const SessionsFileSchema = z.array(SessionInputSchema);

loadDotEnv();
main(process.argv.slice(2)).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

async function main(args: readonly string[]): Promise<void> {
  const [command, arg, ...rest] = args;
  const memory = new Memory({ dbPath: dbPath(), llm: lazyClient() });
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
      for (const session of sessions) {
        const report = await memory.ingest(session);
        const rejected = report.rejected.map((item) => `${item.reason}: ${item.candidate}`).join('; ');
        console.log(
          `s${report.session}: stored ${report.stored.length}, superseded ${report.superseded.length}, tainted ${report.tainted}, cost $${report.cost.toFixed(4)}` +
            (rejected === '' ? '' : `\n  rejected ${rejected}`),
        );
      }
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

// The Anthropic client is created on first use so offline commands never need a key.
function lazyClient(): LlmClient {
  let real: LlmClient | undefined;
  return {
    structured(request) {
      if (real === undefined) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (put it in .env or the environment)');
        real = new AnthropicClient();
      }
      return real.structured(request);
    },
  };
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
