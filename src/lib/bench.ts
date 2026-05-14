// Benchmark engine — TypeScript port of run_bench.py.
//
// Flow per run:
//   1. runProbe(): single 思考探针 to capture protocol fingerprint (thinking
//      encryption, signature, usage fields, input_tokens) and compute
//      authenticity score per BENCHMARK.md §7. Fast (~30s) — gives the user
//      immediate "real / suspicious / fake" verdict before the long QnA.
//   2. QnA loop: callRelay(answer) → callRelay(judge) → grade → persist.
//
// Concurrency on the QnA loop is a simple promise pool. Cancellation is a
// poll on BenchRun.cancelRequested between tasks.
import { prisma } from "./db";
import { sampleByConfig, parseRubric, type SweAtlasRow } from "./bench-dataset";

const ANSWER_SYSTEM =
  "You are a senior software engineer being given a closed-book exam about a " +
  "public open-source repository. You do NOT have shell access, file access, " +
  "internet access, or any tools — do not emit bash blocks, tool calls, or " +
  "'let me check'-style stubs. Answer directly and concretely from your prior " +
  "knowledge of the repository, naming specific files, functions, modules, and " +
  "behaviors when you can. If you genuinely don't know something, state your " +
  "best-supported reasoning and flag the uncertainty — but always commit to a " +
  "real answer rather than deferring to a tool. The repository name and base " +
  "commit will be given in the user message.";

const JUDGE_SYSTEM =
  "You are a strict grader. Given a rubric and a candidate answer, decide for " +
  "each rubric item whether the answer satisfies it. Reply with valid JSON only, " +
  "no prose, no markdown fences.";

function judgePrompt(rubricItems: ReturnType<typeof parseRubric>, answer: string) {
  const rubricView = rubricItems.map((it) => ({
    id: it.id,
    title: it.title,
    importance: it.annotations?.importance ?? "",
  }));
  return (
    `RUBRIC ITEMS (JSON list, each has id/title/importance):\n` +
    `${JSON.stringify(rubricView, null, 0)}\n\n` +
    `CANDIDATE ANSWER:\n${answer}\n\n` +
    `For each rubric item, decide if the candidate answer satisfies it. An item is\n` +
    `satisfied only if the answer clearly conveys the required information; vague or\n` +
    `missing information means not satisfied.\n\n` +
    `Return JSON in exactly this shape:\n` +
    `{"items": [{"id": "...", "satisfied": true/false, "reason": "<=20 words"}]}`
  );
}

interface CallResult {
  text: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation?: unknown;
    service_tier?: string;
  };
  thinkingChars: number;
  hasSignature: boolean;
  // Anthropic Messages stop_reason. Critical for the truncation probe — when
  // upstream silently caps thinking/output, this comes back as "max_tokens"
  // instead of "end_turn".
  stopReason: string;
  // Raw JSON response from /v1/messages, kept around for forensic inspection
  // by the probe step. Only populated when CallOptions.keepRaw is true so the
  // hot QnA loop doesn't cart 30 KB strings around per task.
  rawJson?: string;
}

export class CallError extends Error {
  permanent: boolean;
  status?: number;
  constructor(message: string, opts: { permanent?: boolean; status?: number } = {}) {
    super(message);
    this.permanent = opts.permanent ?? false;
    this.status = opts.status;
  }
}

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: string;
  retries?: number;
  timeoutMs?: number;
  keepRaw?: boolean;
  // Override max_tokens. Defaults to 40000 when effort is set, 4096 when not.
  // Truncation probe uses a high override (~64000) to test if upstream caps it.
  maxTokensOverride?: number;
}

async function callRelay(
  messages: { role: "user"; content: string }[],
  system: string,
  opts: CallOptions,
): Promise<CallResult> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const headers: Record<string, string> = {
    "x-api-key": opts.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  const maxTokens = opts.maxTokensOverride ?? (opts.effort ? 40000 : 4096);
  const payload: Record<string, unknown> = {
    model: opts.model,
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (opts.effort) {
    payload.thinking = { type: "adaptive" };
    payload.output_config = { effort: opts.effort };
  }
  const retries = opts.retries ?? 12;
  const timeoutMs = opts.timeoutMs ?? 900_000;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      const status = r.status;
      const bodyText = await r.text();
      if (status === 200) {
        const data = JSON.parse(bodyText) as {
          content: { type: string; text?: string; thinking?: string; signature?: string }[];
          usage?: CallResult["usage"];
          stop_reason?: string;
        };
        const text = data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        const thinkingChars = data.content
          .filter((b) => b.type === "thinking")
          .reduce((sum, b) => sum + (b.thinking?.length ?? 0), 0);
        const hasSignature = data.content.some(
          (b) => b.type === "thinking" && typeof b.signature === "string" && b.signature.length > 0,
        );
        return {
          text,
          usage: data.usage ?? {},
          thinkingChars,
          hasSignature,
          stopReason: data.stop_reason ?? "",
          rawJson: opts.keepRaw ? bodyText : undefined,
        };
      }
      // 4xx (except 408/429) is permanent — don't waste retries.
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw new CallError(`HTTP ${status} (permanent): ${bodyText.slice(0, 300)}`, {
          permanent: true,
          status,
        });
      }
      lastErr = new CallError(`HTTP ${status}: ${bodyText.slice(0, 300)}`, { status });
    } catch (e) {
      if (e instanceof CallError && e.permanent) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt === retries - 1) break;
    const base = Math.min(60, 2 ** attempt);
    const wait = (base + Math.random() * 2) * 1000;
    await new Promise((res) => setTimeout(res, wait));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function parseJudgeJson(text: string): { items: { id: string; satisfied: boolean; reason?: string }[] } {
  let t = text.trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    if (nl !== -1) t = t.slice(nl + 1);
    const fence = t.lastIndexOf("```");
    if (fence !== -1) t = t.slice(0, fence);
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`no JSON object in judge output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(t.slice(start, end + 1));
}

interface GradeOutcome {
  mustGot: number;
  mustTotal: number;
  allGot: number;
  allTotal: number;
  resolved: boolean;
  answerLatencyS: number;
  judgeLatencyS: number;
  answerText: string;
  judgeRawText: string;
  judgeParsedJson: string;
  answerInputTokens: number;
  answerOutputTokens: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  thinkingChars: number;
  hasSignature: boolean;
  serviceTierPresent: boolean;
  cacheCreationPresent: boolean;
}

async function gradeOne(
  sample: SweAtlasRow,
  opts: { baseUrl: string; apiKey: string; model: string; judgeModel: string; effort: string; judgeEffort: string },
): Promise<GradeOutcome> {
  const userPrompt =
    `Repository: ${sample.repository_url} @ ${sample.repository_base_commit}\n` +
    `Language: ${sample.language}\n\n${sample.prompt}`;

  const t0 = Date.now();
  const ans = await callRelay(
    [{ role: "user", content: userPrompt }],
    ANSWER_SYSTEM,
    { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model, effort: opts.effort },
  );
  const answerLatencyS = (Date.now() - t0) / 1000;

  const rubricItems = parseRubric(sample.rubric);
  const t1 = Date.now();
  const judge = await callRelay(
    [{ role: "user", content: judgePrompt(rubricItems, ans.text) }],
    JUDGE_SYSTEM,
    { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.judgeModel, effort: opts.judgeEffort },
  );
  const judgeLatencyS = (Date.now() - t1) / 1000;
  const parsed = parseJudgeJson(judge.text);
  const byId = new Map(parsed.items.map((it) => [it.id, !!it.satisfied]));

  const mustIds = rubricItems
    .filter((it) => it.annotations?.importance === "must have")
    .map((it) => it.id);
  const mustGot = mustIds.reduce((a, id) => a + (byId.get(id) ? 1 : 0), 0);
  const mustTotal = mustIds.length;
  const allGot = parsed.items.reduce((a, it) => a + (it.satisfied ? 1 : 0), 0);
  const allTotal = rubricItems.length;
  const resolved = mustTotal > 0 && mustGot === mustTotal;

  return {
    mustGot,
    mustTotal,
    allGot,
    allTotal,
    resolved,
    answerLatencyS: Math.round(answerLatencyS * 100) / 100,
    judgeLatencyS: Math.round(judgeLatencyS * 100) / 100,
    answerText: ans.text,
    judgeRawText: judge.text,
    judgeParsedJson: JSON.stringify(parsed),
    answerInputTokens: ans.usage.input_tokens ?? 0,
    answerOutputTokens: ans.usage.output_tokens ?? 0,
    judgeInputTokens: judge.usage.input_tokens ?? 0,
    judgeOutputTokens: judge.usage.output_tokens ?? 0,
    thinkingChars: ans.thinkingChars,
    hasSignature: ans.hasSignature,
    serviceTierPresent: typeof ans.usage.service_tier === "string" && !!ans.usage.service_tier,
    cacheCreationPresent: ans.usage.cache_creation != null,
  };
}

// ============================================================
// Fingerprint probe — single 思考探针 (BENCHMARK.md §3, §7)
// ============================================================

// Roughly the prompt from BENCHMARK.md §3 — chosen because it forces a real
// think-and-prove rather than a pattern match, surfacing reasoning encoding.
const PROBE_PROMPT =
  "In Python, prove or disprove: for any non-empty list L of integers, " +
  "sorted(L)[len(L)//2] equals statistics.median(L). Reason carefully through " +
  "edge cases (even length, duplicates, negatives).";

// Reference 官方 input_tokens for the probe prompt at our exact effort/format.
// Pulled from one official run; used as the "expected" value when checking
// for tokenizer drift in §7's authenticity scoring.
const PROBE_OFFICIAL_INPUT_TOKENS = 70;

export interface ProbeResult {
  ok: boolean;
  error?: string;
  latencyS?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingChars?: number;
  hasSignature?: boolean;
  serviceTierPresent?: boolean;
  cacheCreationPresent?: boolean;
  authenticityScore?: number;
  verdict?: "real" | "suspicious" | "fake";
  answerPreview?: string;
  rawResponse?: string;
}

function clampStr(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function scoreAuthenticity(p: {
  thinkingChars: number;
  hasSignature: boolean;
  serviceTierPresent: boolean;
  cacheCreationPresent: boolean;
  inputTokens: number;
}): { score: number; verdict: "real" | "suspicious" | "fake" } {
  // Weights per BENCHMARK.md §7 红线告警逻辑.
  let score = 0;
  if (p.thinkingChars > 1000) score -= 50;
  if (!p.hasSignature) score -= 50;
  if (!p.serviceTierPresent) score -= 20;
  if (!p.cacheCreationPresent) score -= 20;
  if (PROBE_OFFICIAL_INPUT_TOKENS > 0) {
    const drift =
      Math.abs(p.inputTokens - PROBE_OFFICIAL_INPUT_TOKENS) /
      PROBE_OFFICIAL_INPUT_TOKENS;
    if (drift > 0.5) score -= 30;
  }
  let verdict: "real" | "suspicious" | "fake" = "real";
  if (score < -100) verdict = "fake";
  else if (score < -50) verdict = "suspicious";
  return { score, verdict };
}

export async function runProbe(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: string;
}): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const r = await callRelay(
      [{ role: "user", content: PROBE_PROMPT }],
      // No system here — we want to mirror the doc's bare-prompt probe so
      // the input-token count is comparable to the official baseline.
      "",
      {
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        effort: opts.effort || "high",
        // Probes are time-sensitive: don't burn 12 retries with 60s waits if
        // the relay is dead — we want a fast verdict.
        retries: 3,
        timeoutMs: 180_000,
        keepRaw: true,
      },
    );
    const latencyS = (Date.now() - t0) / 1000;
    const inputTokens = r.usage.input_tokens ?? 0;
    const outputTokens = r.usage.output_tokens ?? 0;
    const serviceTierPresent =
      typeof r.usage.service_tier === "string" && !!r.usage.service_tier;
    const cacheCreationPresent = r.usage.cache_creation != null;
    const { score, verdict } = scoreAuthenticity({
      thinkingChars: r.thinkingChars,
      hasSignature: r.hasSignature,
      serviceTierPresent,
      cacheCreationPresent,
      inputTokens,
    });
    return {
      ok: true,
      latencyS: Math.round(latencyS * 100) / 100,
      inputTokens,
      outputTokens,
      thinkingChars: r.thinkingChars,
      hasSignature: r.hasSignature,
      serviceTierPresent,
      cacheCreationPresent,
      authenticityScore: score,
      verdict,
      answerPreview: clampStr(r.text, 10_000),
      rawResponse: clampStr(r.rawJson, 30_000),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latencyS: Math.round((Date.now() - t0) / 100) / 10,
    };
  }
}

// ────────────────────────────────────────────────────────────────
// 长文本思考截断探针
// ────────────────────────────────────────────────────────────────
// Sends ONE long-thinking prompt with a generous max_tokens budget and
// inspects stop_reason / thinking_chars to detect:
//   - thinking_cut:    stop_reason=max_tokens AND no text  → upstream capped
//                      thinking mid-stream, model never got to answer.
//   - answer_cut:      stop_reason=max_tokens AND text     → output cap binding.
//   - silent_throttle: stop_reason=end_turn   AND thinking_chars too low
//                      relative to expectation → upstream压低了 thinking 预算
//                      but didn't surface it via stop_reason.
//   - network_cut:     fetch/parse failure mid-stream.
//   - ok:              everything looks healthy.

// Prompt chosen to *reliably* induce >5K thinking chars on real Claude at
// high effort: open-ended survey-style comparison with multi-dimensional
// reasoning requirements.
const TRUNC_PROBE_PROMPT =
  "Write a thorough technical comparison of three sorting algorithms: " +
  "merge sort, quicksort, and heapsort. For each, walk carefully through " +
  "(a) the recurrence and rigorous derivation of average-case time " +
  "complexity, (b) worst-case behavior and the inputs that trigger it, " +
  "(c) cache behavior and memory hierarchy effects, (d) stability and " +
  "in-place properties, (e) practical hybrid uses in standard libraries " +
  "(e.g. introsort, Timsort). Reason carefully through each point and " +
  "include concrete numerical comparisons where relevant. Conclude with a " +
  "5-row recommendation matrix mapping scenarios to the preferred algorithm.";

// Minimum thinking_chars we expect from a healthy thinking-enabled run.
// Below this, with stop_reason=end_turn, we flag silent_throttle.
const TRUNC_MIN_THINKING_CHARS = 3000;

// We send this much budget. If a healthy real-Claude run takes ~20-40K
// output tokens for this prompt, 64K leaves comfortable headroom — so any
// max_tokens stop indicates upstream cap, not natural completion.
const TRUNC_PROBE_MAX_TOKENS = 64000;

export interface TruncProbeResult {
  ok: boolean;
  error?: string;
  latencyS?: number;
  requestedMaxTokens: number;
  stopReason?: string;
  outputTokens?: number;
  thinkingChars?: number;
  hasText?: boolean;
  verdict?:
    | "ok"
    | "thinking_cut"
    | "answer_cut"
    | "silent_throttle"
    | "network_cut";
  answerPreview?: string;
}

export async function runTruncationProbe(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: string;
}): Promise<TruncProbeResult> {
  const t0 = Date.now();
  // No thinking on the run → skipping is the honest answer; nothing to truncate.
  if (!opts.effort) {
    return {
      ok: false,
      error: "skipped: run has no thinking enabled",
      requestedMaxTokens: TRUNC_PROBE_MAX_TOKENS,
      latencyS: 0,
    };
  }
  try {
    const r = await callRelay(
      [{ role: "user", content: TRUNC_PROBE_PROMPT }],
      "",
      {
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        effort: opts.effort,
        maxTokensOverride: TRUNC_PROBE_MAX_TOKENS,
        // 3 retries — probe is time-sensitive, not a hot path.
        retries: 3,
        // Long-thinking responses can legitimately take several minutes.
        timeoutMs: 600_000,
        keepRaw: false,
      },
    );
    const latencyS = (Date.now() - t0) / 1000;
    const hasText = r.text.trim().length > 0;
    const stopReason = r.stopReason || "";
    const outputTokens = r.usage.output_tokens ?? 0;
    let verdict: TruncProbeResult["verdict"];
    if (stopReason === "max_tokens") {
      verdict = hasText ? "answer_cut" : "thinking_cut";
    } else if (
      (stopReason === "end_turn" || stopReason === "stop_sequence") &&
      r.thinkingChars < TRUNC_MIN_THINKING_CHARS
    ) {
      verdict = "silent_throttle";
    } else {
      verdict = "ok";
    }
    return {
      ok: true,
      latencyS: Math.round(latencyS * 100) / 100,
      requestedMaxTokens: TRUNC_PROBE_MAX_TOKENS,
      stopReason,
      outputTokens,
      thinkingChars: r.thinkingChars,
      hasText,
      verdict,
      answerPreview: clampStr(r.text, 4000),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latencyS: Math.round((Date.now() - t0) / 100) / 10,
      requestedMaxTokens: TRUNC_PROBE_MAX_TOKENS,
      verdict: "network_cut",
    };
  }
}

// Run a benchmark to completion. Caller has already created BenchRun (status=queued)
// and pre-seeded BenchTask rows for each sampled question.
export async function executeRun(runId: number) {
  const run = await prisma.benchRun.findUnique({
    where: { id: runId },
    include: { tasks: true },
  });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "queued" && run.status !== "running") {
    return; // Already done/canceled.
  }

  await prisma.benchRun.update({
    where: { id: runId },
    data: { status: "running", startedAt: run.startedAt ?? new Date() },
  });

  // 1) Fingerprint probe runs FIRST so the user gets a verdict in ~30s
  //    even if the QnA loop will take 12+ minutes. We don't gate the QnA on
  //    probe success — even if the probe errors, the QnA may still produce
  //    useful bench scores. But we surface the probe error prominently.
  if (run.probeStatus === "pending" || run.probeStatus === "running") {
    await prisma.benchRun.update({
      where: { id: runId },
      data: { probeStatus: "running" },
    });
    const probe = await runProbe({
      baseUrl: run.baseUrl,
      apiKey: run.apiKey,
      model: run.model,
      effort: run.effort,
    });
    if (probe.ok) {
      await prisma.benchRun.update({
        where: { id: runId },
        data: {
          probeStatus: "done",
          probeLatencyS: probe.latencyS,
          probeInputTokens: probe.inputTokens,
          probeOutputTokens: probe.outputTokens,
          probeThinkingChars: probe.thinkingChars,
          probeHasSignature: probe.hasSignature,
          probeServiceTierPresent: probe.serviceTierPresent,
          probeCacheCreationPresent: probe.cacheCreationPresent,
          probeAuthenticityScore: probe.authenticityScore,
          probeVerdict: probe.verdict,
          probeAnswerPreview: probe.answerPreview,
          probeRawResponse: probe.rawResponse,
          // Promote probe forensic flags onto the legacy fields too so the
          // existing list page rendering still works.
          hasSignature: probe.hasSignature,
          serviceTierPresent: probe.serviceTierPresent,
          cacheCreationPresent: probe.cacheCreationPresent,
        },
      });
    } else {
      await prisma.benchRun.update({
        where: { id: runId },
        data: {
          probeStatus: "error",
          probeError: probe.error?.slice(0, 2000),
          probeLatencyS: probe.latencyS,
        },
      });
    }
  }

  // 1b) Truncation probe — opt-in (truncProbeStatus defaults to "not_requested").
  //     Runs only if the user checked the box at run-create time (status set
  //     to "pending") or triggered it manually later.
  await executeTruncProbeForRun(runId);

  // Re-read in case probe just landed and we want fresh values.
  const samples = await sampleByConfig(run.n, run.seed);
  const samplesById = new Map(samples.map((s) => [s.task_id, s]));

  const queue = [...run.tasks].filter((t) => t.status === "pending");
  const inFlight = new Set<Promise<void>>();
  const concurrency = Math.max(1, run.concurrency);

  let canceled = false;

  const checkCancel = async () => {
    const fresh = await prisma.benchRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } });
    if (fresh?.cancelRequested) canceled = true;
  };

  while (queue.length > 0 || inFlight.size > 0) {
    if (canceled) break;
    while (inFlight.size < concurrency && queue.length > 0 && !canceled) {
      const t = queue.shift()!;
      const sample = samplesById.get(t.taskId);
      if (!sample) {
        await prisma.benchTask.update({
          where: { id: t.id },
          data: { status: "error", errorText: "sample not found in dataset", finishedAt: new Date() },
        });
        await prisma.benchRun.update({
          where: { id: runId },
          data: { completedCount: { increment: 1 }, failedCount: { increment: 1 } },
        });
        continue;
      }
      const p = (async () => {
        await prisma.benchTask.update({
          where: { id: t.id },
          data: { status: "running", startedAt: new Date() },
        });
        try {
          const out = await gradeOne(sample, {
            baseUrl: run.baseUrl,
            apiKey: run.apiKey,
            model: run.model,
            judgeModel: run.judgeModel,
            effort: run.effort,
            judgeEffort: run.judgeEffort,
          });
          await prisma.benchTask.update({
            where: { id: t.id },
            data: {
              status: "done",
              mustGot: out.mustGot,
              mustTotal: out.mustTotal,
              allGot: out.allGot,
              allTotal: out.allTotal,
              resolved: out.resolved,
              answerLatencyS: out.answerLatencyS,
              judgeLatencyS: out.judgeLatencyS,
              answerInputTokens: out.answerInputTokens,
              answerOutputTokens: out.answerOutputTokens,
              judgeInputTokens: out.judgeInputTokens,
              judgeOutputTokens: out.judgeOutputTokens,
              thinkingChars: out.thinkingChars,
              hasSignature: out.hasSignature,
              answerText: out.answerText,
              judgeRawText: out.judgeRawText,
              judgeParsedJson: out.judgeParsedJson,
              finishedAt: new Date(),
            },
          });
          // Promote the first task's forensic flags onto the run header.
          await prisma.benchRun.update({
            where: { id: runId },
            data: {
              completedCount: { increment: 1 },
              hasSignature: out.hasSignature,
              serviceTierPresent: out.serviceTierPresent,
              cacheCreationPresent: out.cacheCreationPresent,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await prisma.benchTask.update({
            where: { id: t.id },
            data: { status: "error", errorText: msg, finishedAt: new Date() },
          });
          await prisma.benchRun.update({
            where: { id: runId },
            data: { completedCount: { increment: 1 }, failedCount: { increment: 1 } },
          });
        }
      })();
      inFlight.add(p);
      p.finally(() => inFlight.delete(p));
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
      await checkCancel();
    }
  }

  // Wait for stragglers to complete (or cancel — they'll still finish current task).
  await Promise.allSettled([...inFlight]);

  await finalizeRun(runId, canceled);
}

async function finalizeRun(runId: number, canceled: boolean) {
  const tasks = await prisma.benchTask.findMany({ where: { runId } });
  const ok = tasks.filter((t) => t.status === "done");
  const mustNum = ok.reduce((a, t) => a + (t.mustGot ?? 0), 0);
  const mustDen = ok.reduce((a, t) => a + (t.mustTotal ?? 0), 0);
  const allNum = ok.reduce((a, t) => a + (t.allGot ?? 0), 0);
  const allDen = ok.reduce((a, t) => a + (t.allTotal ?? 0), 0);
  const resolved = ok.filter((t) => t.resolved).length;
  const totalIn = ok.reduce((a, t) => a + (t.answerInputTokens ?? 0) + (t.judgeInputTokens ?? 0), 0);
  const totalOut = ok.reduce((a, t) => a + (t.answerOutputTokens ?? 0) + (t.judgeOutputTokens ?? 0), 0);
  const totalThink = ok.reduce((a, t) => a + (t.thinkingChars ?? 0), 0);
  const avgAns = ok.length ? ok.reduce((a, t) => a + (t.answerLatencyS ?? 0), 0) / ok.length : 0;
  const avgJudge = ok.length ? ok.reduce((a, t) => a + (t.judgeLatencyS ?? 0), 0) / ok.length : 0;

  const failed = tasks.filter((t) => t.status === "error").length;
  const status = canceled ? "canceled" : failed === tasks.length ? "error" : "done";

  await prisma.benchRun.update({
    where: { id: runId },
    data: {
      status,
      completedCount: tasks.filter((t) => t.status !== "pending" && t.status !== "running").length,
      failedCount: failed,
      mustHavePassRate: mustDen ? mustNum / mustDen : 0,
      taskResolveRate: ok.length ? resolved / ok.length : 0,
      allItemsPassRate: allDen ? allNum / allDen : 0,
      avgAnswerLatencyS: Math.round(avgAns * 100) / 100,
      avgJudgeLatencyS: Math.round(avgJudge * 100) / 100,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      totalThinkingChars: totalThink,
      finishedAt: new Date(),
    },
  });
}

// 把指定 task(必须 status=error)重置为 pending,然后重新触发引擎。供
// "单题重试" / "重跑所有失败" 用 — 两个入口共用一份重置 + 重启逻辑,
// 避免每个 API 路由各自拼一遍 SQL 漏字段。
//
// 安全约束: run 还在 queued/running 时拒绝 — executeRun 的 queue
// 是在函数开头一次性 snapshot 的(bench.ts:596),正在跑的执行不会捡到
// 中途新加入的 pending,这时候 retry 会被丢掉。先让用户取消等收尾。
export async function retryTasks(
  runId: number,
  taskIds: number[],
): Promise<{ restarted: number }> {
  if (taskIds.length === 0) return { restarted: 0 };
  const run = await prisma.benchRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "queued" || run.status === "running") {
    throw new Error("run 还在执行中,先等它结束或取消再重试");
  }
  const targets = await prisma.benchTask.findMany({
    where: { runId, id: { in: taskIds }, status: "error" },
    select: { id: true },
  });
  if (targets.length === 0) return { restarted: 0 };
  const ids = targets.map((t) => t.id);

  await prisma.$transaction([
    prisma.benchTask.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "pending",
        errorText: null,
        startedAt: null,
        finishedAt: null,
        mustGot: null,
        mustTotal: null,
        allGot: null,
        allTotal: null,
        resolved: null,
        answerLatencyS: null,
        judgeLatencyS: null,
        answerInputTokens: null,
        answerOutputTokens: null,
        judgeInputTokens: null,
        judgeOutputTokens: null,
        thinkingChars: null,
        hasSignature: null,
        answerText: null,
        judgeRawText: null,
        judgeParsedJson: null,
      },
    }),
    // failedCount 和 completedCount 当时是 error 完结时累计的;重置回
    // pending 等于把那次失败"未发生过"。finalizeRun 末尾会重算这两个
    // 值兜底,但这里也得先减下来不然 UI 进度条会卡在满格。
    prisma.benchRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        cancelRequested: false,
        errorSummary: null,
        finishedAt: null,
        failedCount: { decrement: ids.length },
        completedCount: { decrement: ids.length },
      },
    }),
  ]);
  startInBackground(runId);
  return { restarted: ids.length };
}

// In-process registry of running benches so we don't double-spawn the engine
// for the same run id (e.g. if the user accidentally hits "start" twice).
const running = new Set<number>();

export function startInBackground(runId: number) {
  if (running.has(runId)) return;
  running.add(runId);
  // Detach: we don't await this; the API route returns immediately while
  // the engine writes progress to the DB.
  executeRun(runId)
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.benchRun.update({
        where: { id: runId },
        data: { status: "error", errorSummary: msg, finishedAt: new Date() },
      }).catch(() => {});
    })
    .finally(() => {
      running.delete(runId);
    });
}

// Runs the truncation probe for a given run, but only if the user has opted
// in (truncProbeStatus = pending or running). Called from executeRun in the
// regular flow, and from the standalone trigger endpoint to retro-run on
// existing finished runs.
export async function executeTruncProbeForRun(runId: number) {
  const run = await prisma.benchRun.findUnique({ where: { id: runId } });
  if (!run) return;
  if (
    run.truncProbeStatus !== "pending" &&
    run.truncProbeStatus !== "running"
  ) {
    return;
  }
  await prisma.benchRun.update({
    where: { id: runId },
    data: { truncProbeStatus: "running" },
  });
  const t = await runTruncationProbe({
    baseUrl: run.baseUrl,
    apiKey: run.apiKey,
    model: run.model,
    effort: run.effort,
  });
  if (t.ok) {
    await prisma.benchRun.update({
      where: { id: runId },
      data: {
        truncProbeStatus: "done",
        truncProbeError: null,
        truncProbeLatencyS: t.latencyS,
        truncProbeRequestedMaxTokens: t.requestedMaxTokens,
        truncProbeStopReason: t.stopReason ?? null,
        truncProbeOutputTokens: t.outputTokens ?? null,
        truncProbeThinkingChars: t.thinkingChars ?? null,
        truncProbeHasText: t.hasText ?? null,
        truncProbeVerdict: t.verdict ?? null,
        truncProbeAnswerPreview: t.answerPreview ?? null,
      },
    });
  } else if (t.error?.startsWith("skipped:")) {
    await prisma.benchRun.update({
      where: { id: runId },
      data: {
        truncProbeStatus: "skipped",
        truncProbeError: t.error.slice(0, 2000),
        truncProbeLatencyS: t.latencyS,
        truncProbeRequestedMaxTokens: t.requestedMaxTokens,
      },
    });
  } else {
    await prisma.benchRun.update({
      where: { id: runId },
      data: {
        truncProbeStatus: "error",
        truncProbeError: t.error?.slice(0, 2000),
        truncProbeLatencyS: t.latencyS,
        truncProbeRequestedMaxTokens: t.requestedMaxTokens,
        truncProbeVerdict: t.verdict ?? null,
      },
    });
  }
}

const truncRunning = new Set<number>();

// Detached trigger for the truncation probe alone — used by the manual
// "开始检测" button on the bench detail page, for finished runs whose owner
// didn't opt in at create time.
export function startTruncProbeInBackground(runId: number) {
  if (truncRunning.has(runId)) return;
  truncRunning.add(runId);
  executeTruncProbeForRun(runId)
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.benchRun
        .update({
          where: { id: runId },
          data: {
            truncProbeStatus: "error",
            truncProbeError: msg.slice(0, 2000),
          },
        })
        .catch(() => {});
    })
    .finally(() => {
      truncRunning.delete(runId);
    });
}
