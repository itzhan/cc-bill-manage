import { spawn } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "./db";

// veridrop 输出 JSON 报告 (relay-detector cli `--output` flag)。schema 见
// /vendor/veridrop/src/relay_detector/core/models.py:106 (DetectionReport)。
// 我们存原始 JSON 串到 DB, 解析交前端;同时把几个顶层字段(总分/verdict/
// summary)抽出来落到列, 列表展示不用每行 parse blob。
//
// 走 child_process.spawn /opt/veridrop/venv/bin/relay-detector detect 这个
// CLI(Docker runner 里 PATH 注入了 VERIDROP_BIN)。本地开发环境如果没装
// veridrop, runVeridropDetection 会抛 ENOENT, 前端会显示 errorText。

interface RunOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  // anthropic | openai | gemini
  protocol: string;
  // quick | standard | full
  mode: string;
  // 默认 600s 兜底, full 模式典型 70s 但 long-context 之类可能长。
  timeoutMs?: number;
}

interface RunResult {
  ok: true;
  report: unknown; // 解析自 JSON, 由前端按 veridrop schema 渲染
  rawJson: string;
  totalScore: number | null;
  verdict: string | null;
  summary: string | null;
}
interface RunError {
  ok: false;
  error: string;
  rawStdout?: string;
  rawStderr?: string;
}

function veridropBin(): string {
  return process.env.VERIDROP_BIN || "relay-detector";
}

// veridrop 的 anthropic.baseline_path / openai.* 用相对路径 "data/baselines/..."
// 从 CWD 查基线 JSON; 我们必须把 spawn 的 cwd 设到 vendor 源码目录, 不然
// 找不到 baseline 会让一部分 detector 拿不到对照, 影响打分。
function veridropCwd(): string {
  // pybuild 把 vendor/veridrop COPY 到 /opt/veridrop/src-veridrop
  return process.env.VERIDROP_CWD || "/opt/veridrop/src-veridrop";
}

export async function runVeridropDetection(
  opts: RunOpts,
): Promise<RunResult | RunError> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "veridrop-"));
  const outPath = path.join(tmpDir, "report.json");
  const timeoutMs = opts.timeoutMs ?? 600_000;
  try {
    const args = [
      "detect",
      "--base-url",
      opts.baseUrl,
      "--api-key",
      opts.apiKey,
      "--model",
      opts.model,
      "--mode",
      opts.mode,
      "--protocol",
      opts.protocol,
      "--output",
      outPath,
    ];
    const result = await spawnAndWait(
      veridropBin(),
      args,
      timeoutMs,
      veridropCwd(),
    );
    if (result.timedOut) {
      return {
        ok: false,
        error: `veridrop 超时 (>${Math.round(timeoutMs / 1000)}s)`,
        rawStdout: result.stdout,
        rawStderr: result.stderr,
      };
    }
    // 即使非 0 退出, 也尝试读 JSON — veridrop 在 failed/marginal 时会
    // 用非 0 code 退出但仍写出报告。
    let raw: string;
    try {
      raw = await readFile(outPath, "utf-8");
    } catch (e) {
      return {
        ok: false,
        error: `读取报告失败: ${e instanceof Error ? e.message : String(e)}`,
        rawStdout: result.stdout,
        rawStderr: result.stderr,
      };
    }
    let report: unknown;
    try {
      report = JSON.parse(raw);
    } catch (e) {
      return {
        ok: false,
        error: `报告不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`,
        rawStdout: result.stdout,
        rawStderr: result.stderr,
      };
    }
    const r = report as Record<string, unknown>;
    const totalScore =
      typeof r.total_score === "number" ? r.total_score : null;
    const verdict = typeof r.verdict === "string" ? r.verdict : null;
    const summary = typeof r.summary === "string" ? r.summary : null;
    return { ok: true, report, rawJson: raw, totalScore, verdict, summary };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function spawnAndWait(
  bin: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
      cwd,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      // SIGKILL 兜底 5s 后
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 5000);
    }, timeoutMs);
    child.stdout?.on("data", (b) => (stdout += b.toString()));
    child.stderr?.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

// === 后台执行: 创建 VeridropRun(status=queued), 起一个不 await 的 promise
// 跑 runVeridropDetection, 完成后 update 行 ===
export async function startVeridropRun(opts: {
  channelKeyId: number;
  protocol: string;
  mode: string;
  model: string;
}): Promise<{ id: number }> {
  const key = await prisma.benchChannelKey.findUnique({
    where: { id: opts.channelKeyId },
    include: { channel: true },
  });
  if (!key) throw new Error("bench channel key not found");
  const run = await prisma.veridropRun.create({
    data: {
      channelKeyId: opts.channelKeyId,
      protocol: opts.protocol,
      mode: opts.mode,
      model: opts.model,
      status: "queued",
    },
  });
  // fire and forget;executeRun 自己做 status 维护 + 错误捕获
  void executeRun(run.id, {
    baseUrl: key.channel.baseUrl,
    apiKey: key.apiKey,
    model: opts.model,
    protocol: opts.protocol,
    mode: opts.mode,
  });
  return { id: run.id };
}

async function executeRun(runId: number, opts: RunOpts) {
  try {
    await prisma.veridropRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date() },
    });
    const r = await runVeridropDetection(opts);
    if (!r.ok) {
      await prisma.veridropRun.update({
        where: { id: runId },
        data: {
          status: "error",
          finishedAt: new Date(),
          errorText: [r.error, r.rawStderr?.slice(-1000)]
            .filter(Boolean)
            .join("\n---stderr---\n")
            .slice(0, 4000),
        },
      });
      return;
    }
    await prisma.veridropRun.update({
      where: { id: runId },
      data: {
        status: "done",
        finishedAt: new Date(),
        totalScore: r.totalScore ?? undefined,
        verdict: r.verdict ?? undefined,
        summary: r.summary ?? undefined,
        reportJson: r.rawJson,
      },
    });
  } catch (e) {
    await prisma.veridropRun
      .update({
        where: { id: runId },
        data: {
          status: "error",
          finishedAt: new Date(),
          errorText:
            e instanceof Error ? e.message.slice(0, 4000) : String(e),
        },
      })
      .catch(() => {});
  }
}
