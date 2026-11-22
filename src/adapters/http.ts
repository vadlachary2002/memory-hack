// HTTP adapter: JSON in, JSON out, same shapes as the library. No framework, node:http only.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Memory } from '../memory.js';
import { ForgetTargetSchema, SessionInputSchema } from '../types.js';

const AskBodySchema = z.object({ question: z.string().min(1), asOf: z.number().int().positive().optional() });

const MAX_BODY_BYTES = 1_000_000;

export function createApp(memory: Memory): Server {
  return createServer((request, response) => {
    handle(memory, request, response).catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

// Resolves once the server is listening. Port 0 picks a free port, used by tests.
export function startServer(memory: Memory, port: number): Promise<Server> {
  const server = createApp(memory);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function handle(memory: Memory, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = `${request.method ?? 'GET'} ${url.pathname}`;
  switch (route) {
    case 'POST /ingest':
      return send(response, 200, await memory.ingest(SessionInputSchema.parse(await body(request))));
    case 'POST /ask': {
      const { question, asOf } = AskBodySchema.parse(await body(request));
      return send(response, 200, await memory.ask(question, asOf === undefined ? {} : { asOf }));
    }
    case 'POST /forget':
      return send(response, 200, memory.forget(ForgetTargetSchema.parse(await body(request))));
    case 'POST /reset':
      memory.reset();
      return send(response, 200, { ok: true });
    case 'GET /summary': {
      const session = url.searchParams.get('session');
      return send(response, 200, { text: memory.summarise(session === null ? {} : { session: Number(session) }) });
    }
    case 'GET /audit': {
      const name = url.searchParams.get('name') ?? '';
      if (name === '') return send(response, 400, { error: 'name is required' });
      return send(response, 200, memory.audit(name));
    }
    case 'GET /cost':
      return send(response, 200, memory.cost());
    case 'GET /health':
      return send(response, 200, { ok: true });
    default:
      return send(response, 404, { error: `no route ${route}` });
  }
}

function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new Error('body too large'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}
