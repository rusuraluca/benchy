import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { CaseOutcome, RunRecord, RunSummary, ResultRow } from '../core/types';

export interface CreateRunInput {
  label: string;
  startedAt?: string;
  config: Record<string, unknown>;
  outcomes: CaseOutcome[];
  summary: RunSummary;
  status: 'passed' | 'failed' | 'aborted';
}

export class Store {
  private readonly db: Database.Database;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new Database(`${dir}/benchy.db`);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        status TEXT NOT NULL,
        config TEXT NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        case_index INTEGER NOT NULL,
        case_id TEXT NOT NULL,
        title TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        latency_ms REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        scorers TEXT NOT NULL DEFAULT '[]',
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
      CREATE INDEX IF NOT EXISTS idx_results_case ON results(case_id);
    `);
  }

  createRun(input: CreateRunInput): string {
    const id = randomUUID();
    const now = input.startedAt ?? new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO runs (id, label, started_at, finished_at, status, config, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      id,
      input.label,
      now,
      now,
      input.status,
      JSON.stringify(input.config),
      JSON.stringify(input.summary),
    );

    const insertResult = this.db.prepare(`
      INSERT INTO results
        (run_id, case_index, case_id, title, tags, status, latency_ms, cost_usd,
         tokens_in, tokens_out, scorers, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((outcomes: CaseOutcome[]) => {
      for (const o of outcomes) {
        insertResult.run(
          id,
          o.index,
          o.spec.id,
          o.spec.name ?? o.spec.id,
          JSON.stringify(o.spec.tags ?? []),
          o.status,
          o.latencyMs,
          o.costUsd,
          o.usage.in ?? 0,
          o.usage.out ?? 0,
          JSON.stringify(o.scorers),
          JSON.stringify({
            input: o.spec.input,
            expected: o.spec.expected,
            error: o.error,
            response: o.response,
            usage: o.usage,
          }),
          now,
        );
      }
    });
    tx(input.outcomes);
    return id;
  }

  listRuns(limit = 50): RunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as unknown as Array<Record<string, unknown>>;
    return rows.map(parseRunRow);
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? parseRunRow(row) : undefined;
  }

  findRun(ref: string): RunRecord | undefined {
    const exact = this.getRun(ref);
    if (exact) return exact;
    const row = this.db
      .prepare('SELECT * FROM runs WHERE label = ? ORDER BY started_at DESC LIMIT 1')
      .get(ref) as Record<string, unknown> | undefined;
    return row ? parseRunRow(row) : undefined;
  }

  getResults(runId: string): ResultRow[] {
    const rows = this.db
      .prepare('SELECT * FROM results WHERE run_id = ? ORDER BY case_index ASC')
      .all(runId) as unknown as Array<Record<string, unknown>>;
    return rows.map(parseResultRow);
  }

  deleteRun(id: string): boolean {
    return this.db.prepare('DELETE FROM runs WHERE id = ?').run(id).changes > 0;
  }

  countRuns(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

function parseRunRow(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
    status: row.status as RunRecord['status'],
    config: JSON.parse(String(row.config)) as Record<string, unknown>,
    summary: JSON.parse(String(row.summary)) as RunSummary,
  };
}

function parseResultRow(row: Record<string, unknown>): ResultRow {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    caseIndex: Number(row.case_index),
    caseId: String(row.case_id),
    title: String(row.title),
    tags: String(row.tags),
    status: row.status as ResultRow['status'],
    latencyMs: Number(row.latency_ms),
    costUsd: Number(row.cost_usd),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    scorers: String(row.scorers),
    detail: String(row.detail),
    createdAt: String(row.created_at),
  };
}
