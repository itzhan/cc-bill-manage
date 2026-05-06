// SWE-Atlas-QnA dataset loader. The 124-row dataset is vendored as a JSON
// blob in src/data/swe-atlas-qna.json (~590 KB) and imported at module
// load so Next.js bundles it into the standalone output (no runtime fs
// reads, no concerns about Docker bind-mounts hiding it).
import datasetJson from "@/data/swe-atlas-qna.json";

export interface SweAtlasRow {
  task_id: string;
  prompt: string;
  repository_url: string;
  repository_base_commit: string;
  language: string;
  category: string;
  // JSON-encoded array of {id, title, annotations:{importance:"must have"|...}}.
  rubric: string;
}

const dataset = datasetJson as SweAtlasRow[];

export async function loadDataset(): Promise<SweAtlasRow[]> {
  return dataset;
}

// The 30 task_ids that make up the "经典 30 题" official baseline
// (n=30, seed=42 in run_bench.py). Hardcoding these saves us from having
// to replicate Python's random.Random(42).sample(...) byte-for-byte;
// it also guarantees alignment with the vendored official scores.
const OFFICIAL_30_TASK_IDS: string[] = [
  "6905333b74f22949d97ba999",
  "6905333b74f22949d97ba99b",
  "6905333b74f22949d97ba9a3",
  "6905333b74f22949d97ba9a8",
  "6905333b74f22949d97ba9b3",
  "6905333b74f22949d97ba9b8",
  "6905333b74f22949d97ba9bb",
  "6905333b74f22949d97ba9bc",
  "6905333b74f22949d97ba9bd",
  "6905333b74f22949d97ba9c5",
  "6905333b74f22949d97ba9c8",
  "6905333b74f22949d97ba9c9",
  "6905333b74f22949d97ba9cf",
  "6905333b74f22949d97ba9d2",
  "6905333b74f22949d97ba9e1",
  "6905333b74f22949d97ba9e4",
  "6905333b74f22949d97ba9eb",
  "6905333b74f22949d97ba9f4",
  "6905333b74f22949d97ba9f5",
  "6905333b74f22949d97ba9f8",
  "6905333b74f22949d97ba9f9",
  "6905333b74f22949d97ba9fa",
  "6905333b74f22949d97ba9ff",
  "6905333b74f22949d97baa0b",
  "6905333b74f22949d97baa16",
  "6905333b74f22949d97baa19",
  "6905333b74f22949d97baa1c",
  "6905333b74f22949d97baa22",
  "6905333b74f22949d97baa28",
  "6905333b74f22949d97baa2d",
];

// Tiny seeded PRNG (mulberry32). Used for n != 30 or seed != 42 — those
// modes have no official baseline anyway, so the only requirement is
// "deterministic given (n, seed)".
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicSample<T>(arr: T[], n: number, seed: number): T[] {
  const idx = arr.map((_, i) => i);
  const rand = mulberry32(seed);
  // Fisher-Yates shuffle, take first n.
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => arr[i]);
}

export async function sampleByConfig(
  n: number,
  seed: number,
): Promise<SweAtlasRow[]> {
  const ds = await loadDataset();
  if (n === 30 && seed === 42) {
    const byId = new Map(ds.map((r) => [r.task_id, r]));
    const out: SweAtlasRow[] = [];
    for (const id of OFFICIAL_30_TASK_IDS) {
      const r = byId.get(id);
      if (r) out.push(r);
    }
    return out;
  }
  return deterministicSample(ds, Math.min(n, ds.length), seed);
}

export interface RubricItem {
  id: string;
  title: string;
  annotations?: { importance?: string };
}

export function parseRubric(rubricJson: string): RubricItem[] {
  return JSON.parse(rubricJson) as RubricItem[];
}
