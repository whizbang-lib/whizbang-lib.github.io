import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface TestStatusRun {
  runId: string | null;
  sha: string | null;
  branch: string | null;
  libraryVersion: string | null;
  completedAt: string;
}

export interface TestStatusIndex {
  run: TestStatusRun;
  total: { passed: number; failed: number; skipped: number };
  suites: Record<string, { passed: number; failed: number; skipped: number }>;
  assemblies: Record<string, { file: string; passed: number; failed: number; skipped: number }>;
}

export interface TestOutcome {
  o: 'passed' | 'failed' | 'skipped';
  d: number; // duration ms
  s: string; // suite
}

export interface ClassStatus {
  className: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Live test-status data stitched from library CI runs (TRX → JSON via
 * src/scripts/build-test-status.mjs, committed to src/assets/data/test-status/
 * by the library's publish-test-status job). Keys follow the
 * code-tests-map.json identity: `<ShortClassName>.<TestMethodName>`.
 */
@Injectable({ providedIn: 'root' })
export class TestStatusService {
  private http = inject(HttpClient);

  private readonly _index = signal<TestStatusIndex | null>(null);
  private readonly _loaded = signal(false);
  readonly index = this._index.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  private shardCache = new Map<string, Record<string, TestOutcome>>();
  private indexPromise: Promise<TestStatusIndex | null> | null = null;

  /** Loads index.json once; resolves null when no status data is published. */
  async ensureIndex(): Promise<TestStatusIndex | null> {
    if (this._index()) return this._index();
    this.indexPromise ??= firstValueFrom(
      this.http.get<TestStatusIndex>('assets/data/test-status/index.json')
    ).then(
      (idx) => {
        this._index.set(idx);
        this._loaded.set(true);
        return idx;
      },
      () => {
        this._loaded.set(true);
        return null; // data file absent — pipeline not yet publishing
      }
    );
    return this.indexPromise;
  }

  /** Days since the run completed, or null when unknown. */
  staleDays(): number | null {
    const at = this._index()?.run?.completedAt;
    if (!at) return null;
    return Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  }

  private async loadShard(assembly: string): Promise<Record<string, TestOutcome> | null> {
    if (this.shardCache.has(assembly)) return this.shardCache.get(assembly)!;
    const idx = await this.ensureIndex();
    const file = idx?.assemblies?.[assembly]?.file;
    if (!file) return null;
    try {
      const shard = await firstValueFrom(
        this.http.get<Record<string, TestOutcome>>(`assets/data/test-status/${file}`)
      );
      this.shardCache.set(assembly, shard);
      return shard;
    } catch {
      return null;
    }
  }

  /**
   * Aggregate status for a test class (short name, e.g. "DispatcherTests").
   * Scans loaded assembly shards; loads all assemblies listed in the index on
   * first call (shards are small per-assembly files).
   */
  async getClassStatus(className: string): Promise<ClassStatus | null> {
    const idx = await this.ensureIndex();
    if (!idx) return null;
    const prefix = `${className}.`;
    const agg: ClassStatus = { className, total: 0, passed: 0, failed: 0, skipped: 0 };
    for (const assembly of Object.keys(idx.assemblies)) {
      const shard = await this.loadShard(assembly);
      if (!shard) continue;
      for (const [key, res] of Object.entries(shard)) {
        if (!key.startsWith(prefix)) continue;
        agg.total++;
        agg[res.o]++;
      }
      if (agg.total > 0) break; // class lives in one assembly
    }
    return agg.total > 0 ? agg : null;
  }

  /** Status for a single test method key `Class.MethodAsync`. */
  async getTestStatus(key: string): Promise<TestOutcome | null> {
    const idx = await this.ensureIndex();
    if (!idx) return null;
    for (const assembly of Object.keys(idx.assemblies)) {
      const shard = await this.loadShard(assembly);
      if (shard && shard[key]) return shard[key];
    }
    return null;
  }
}
