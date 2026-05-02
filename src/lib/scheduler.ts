import { prisma } from "./db";
import { syncAll } from "./sync";

declare global {
  // eslint-disable-next-line no-var
  var __billManageScheduler:
    | { intervalMin: number; timer: NodeJS.Timeout; running: boolean }
    | undefined;
}

let starting = false;

async function runOnce() {
  if (globalThis.__billManageScheduler?.running) return;
  if (globalThis.__billManageScheduler) {
    globalThis.__billManageScheduler.running = true;
  }
  try {
    await syncAll();
  } catch (e) {
    console.error("[scheduler] syncAll failed:", e);
  } finally {
    if (globalThis.__billManageScheduler) {
      globalThis.__billManageScheduler.running = false;
    }
  }
}

export async function ensureScheduler() {
  if (globalThis.__billManageScheduler || starting) return;
  starting = true;
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const minutes = Math.max(1, settings?.syncIntervalMinutes ?? 5);
    const ms = minutes * 60 * 1000;
    const timer = setInterval(() => {
      runOnce().catch((e) => console.error(e));
    }, ms);
    globalThis.__billManageScheduler = { intervalMin: minutes, timer, running: false };
    console.log(`[scheduler] started, every ${minutes} min`);
    // kick off one run shortly after boot, but don't block the request
    setTimeout(() => {
      runOnce().catch((e) => console.error(e));
    }, 5000);
  } finally {
    starting = false;
  }
}

export async function restartScheduler() {
  if (globalThis.__billManageScheduler) {
    clearInterval(globalThis.__billManageScheduler.timer);
    globalThis.__billManageScheduler = undefined;
  }
  await ensureScheduler();
}
