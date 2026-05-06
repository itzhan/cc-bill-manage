import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadDataset } from "@/lib/bench-dataset";

export const runtime = "nodejs";

// Returns one task's full record, including bulky payloads (answer/judge raw),
// merged with the original prompt + rubric from the dataset for display.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await ctx.params;
  const task = await prisma.benchTask.findFirst({
    where: { runId: Number(id), taskId },
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ds = await loadDataset();
  const sample = ds.find((r) => r.task_id === taskId);
  return NextResponse.json({
    task,
    prompt: sample?.prompt ?? null,
    repository_url: sample?.repository_url ?? null,
    repository_base_commit: sample?.repository_base_commit ?? null,
    rubric: sample ? JSON.parse(sample.rubric) : null,
  });
}
