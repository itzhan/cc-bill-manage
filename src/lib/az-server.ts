// Server-only helpers for the az batch tool. Wraps Sub2ApiClient with
// SiteAccount credentials and persists token refreshes.
import { prisma } from "./db";
import { Sub2ApiClient } from "./sub2api";

export async function makeSiteClient(siteId: number): Promise<Sub2ApiClient> {
  const acc = await prisma.siteAccount.findUnique({ where: { id: siteId } });
  if (!acc) throw new Error("site account not found");
  if (acc.type !== "sub2api") {
    throw new Error(`az tool only supports sub2api site accounts (got ${acc.type})`);
  }
  return new Sub2ApiClient(
    {
      baseUrl: acc.baseUrl,
      email: acc.email,
      password: acc.password,
      accessToken: acc.accessToken,
    },
    {
      onTokenRefreshed: async (newToken, expiresInSec) => {
        await prisma.siteAccount.update({
          where: { id: siteId },
          data: {
            accessToken: newToken,
            tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
          },
        });
      },
    },
  );
}

// Run async tasks with a fixed concurrency. Replaces ad-hoc Promise.all
// when we want to throttle (sub2api batch endpoints recommend 10).
export async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
