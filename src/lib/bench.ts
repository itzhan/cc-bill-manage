// Benchmark engine — TypeScript port of run_bench.py.
//
// Flow per task: callRelay(answer prompt) → callRelay(judge prompt) →
// extract JSON from judge → count must_have/all satisfied → persist BenchTask.
// Concurrency is a simple promise pool. Cancellation is a poll on
// BenchRun.cancelRequested between tasks.
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
  const maxTokens = opts.effort ? 40000 : 4096;
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
