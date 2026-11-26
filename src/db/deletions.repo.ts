// Record of forget requests carried out. Ids and counts only, never a name.

import type { Db } from './connection.js';
import type { ForgetReport, ForgetTarget } from '../types.js';

export type DeletionRow = {
  id: number;
  atSession: number;
  kind: ForgetTarget['kind'];
  entityCount: number;
  erasedFacts: number;
  strippedFacts: number;
  redactedTurns: number;
  scanClean: boolean;
};

type RawRow = { id: number; requested_at: number; target_json: string; report_json: string };

export class DeletionsRepo {
  constructor(private readonly db: Db) {}

  record(target: ForgetTarget, report: ForgetReport, atSession: number): number {
    const info = this.db
      .prepare('INSERT INTO deletions (target_json, requested_at, report_json) VALUES (?, ?, ?)')
      .run(JSON.stringify({ kind: target.kind }), atSession, JSON.stringify(report));
    return Number(info.lastInsertRowid);
  }

  all(): DeletionRow[] {
    const rows = this.db.prepare('SELECT * FROM deletions ORDER BY id').all() as RawRow[];
    return rows.map((raw) => {
      const target = JSON.parse(raw.target_json) as { kind: ForgetTarget['kind'] };
      const report = JSON.parse(raw.report_json) as ForgetReport;
      return {
        id: raw.id,
        atSession: raw.requested_at,
        kind: target.kind,
        entityCount: report.entityIds.length,
        erasedFacts: report.erasedFacts.length,
        strippedFacts: report.strippedFacts.length,
        redactedTurns: report.redactedTurns.length,
        scanClean: report.scanClean,
      };
    });
  }
}
