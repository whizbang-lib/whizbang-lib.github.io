/**
 * Live test-status lookup — fetches the docs site's published CI results
 * (src/assets/data/test-status/, produced by the library's publish-test-status
 * job) so clients can see whether a test class/method currently passes on
 * develop. Always remote (never bundled) so status can't go stale silently;
 * 15-minute in-memory cache.
 */

export interface GetTestStatusParams {
  /** Short test class name (e.g. "DispatcherTests") or "Class.MethodAsync" key. */
  test: string;
}

export interface TestStatusEntry {
  key: string;
  outcome: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  suite: string;
}

export interface GetTestStatusResult {
  available: boolean;
  message?: string;
  run?: {
    runId: string | null;
    sha: string | null;
    branch: string | null;
    completedAt: string;
    ageDays: number;
  };
  matches: TestStatusEntry[];
  summary?: { passed: number; failed: number; skipped: number };
}

interface StatusIndex {
  run: { runId: string | null; sha: string | null; branch: string | null; completedAt: string };
  total: { passed: number; failed: number; skipped: number };
  assemblies: Record<string, { file: string; passed: number; failed: number; skipped: number }>;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function fetchJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

export async function getTestStatusFunc(
  params: GetTestStatusParams,
  docsBaseUrl: string
): Promise<GetTestStatusResult> {
  const base = `${docsBaseUrl.replace(/\/$/, '')}/assets/data/test-status`;
  const index = await fetchJson<StatusIndex>(`${base}/index.json`);
  if (!index) {
    return {
      available: false,
      message:
        'No live test-status data published (pipeline not yet enabled, or site unreachable). Existence of tests can still be checked with get-tests-for-code.',
      matches: [],
    };
  }

  const query = params.test.trim();
  const wantsMethod = query.includes('.');
  const classPrefix = wantsMethod ? query : `${query}.`;

  const matches: TestStatusEntry[] = [];
  const summary = { passed: 0, failed: 0, skipped: 0 };

  for (const [, info] of Object.entries(index.assemblies)) {
    const shard = await fetchJson<Record<string, { o: TestStatusEntry['outcome']; d: number; s: string }>>(
      `${base}/${info.file}`
    );
    if (!shard) continue;
    for (const [key, res] of Object.entries(shard)) {
      const hit = wantsMethod ? key === query : key.startsWith(classPrefix);
      if (!hit) continue;
      matches.push({ key, outcome: res.o, durationMs: res.d, suite: res.s });
      summary[res.o]++;
    }
    if (matches.length > 0) break; // a class lives in exactly one assembly
  }

  const completedAt = index.run?.completedAt ?? '';
  return {
    available: true,
    run: {
      runId: index.run?.runId ?? null,
      sha: index.run?.sha ?? null,
      branch: index.run?.branch ?? null,
      completedAt,
      ageDays: completedAt ? Math.floor((Date.now() - new Date(completedAt).getTime()) / 86_400_000) : -1,
    },
    matches,
    summary: matches.length > 0 ? summary : undefined,
  };
}
