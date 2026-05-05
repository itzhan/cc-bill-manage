// Routes UpstreamAccount to the correct adapter based on its `type`.
// Both clients implement the upstream-side surface used by sync.ts:
//   getMe, listKeys, getKeysUsage, getUserGroupRates.

import { prisma } from "./db";
import { Sub2ApiClient } from "./sub2api";
import type { KeyItem, KeyUsageItem } from "./sub2api";
import { NewApiClient } from "./newapi";

export interface UpstreamApiClient {
  getMe(): Promise<{
    id: number;
    email: string;
    username: string;
    balance: number;
    role: string;
  }>;
  listKeys(): Promise<KeyItem[]>;
  getKeysUsage(ids: number[]): Promise<Record<string, KeyUsageItem>>;
  getUserGroupRates(): Promise<Record<string | number, number>>;
}

interface UpstreamAccountRow {
  id: number;
  type: string;
  baseUrl: string;
  email: string;
  password: string;
  apiKey?: string | null;
  accessToken: string | null;
  remoteUserId?: number | null;
}

export function makeUpstreamApiClient(
  acc: UpstreamAccountRow,
): UpstreamApiClient {
  if (acc.type === "newapi") {
    return new NewApiClient(
      {
        baseUrl: acc.baseUrl,
        email: acc.email,
        password: acc.password,
        cookieJar: acc.accessToken,
        userId: acc.remoteUserId ?? null,
      },
      {
        onSession: async (cookieJar, userId, expiresInSec) => {
          await prisma.upstreamAccount.update({
            where: { id: acc.id },
            data: {
              accessToken: cookieJar,
              remoteUserId: userId,
              tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
            },
          });
        },
      },
    );
  }
  // default: sub2api
  return new Sub2ApiClient(
    {
      baseUrl: acc.baseUrl,
      email: acc.email,
      password: acc.password,
      apiKey: acc.apiKey ?? null,
      accessToken: acc.accessToken,
    },
    {
      onTokenRefreshed: async (newToken, expiresInSec) => {
        await prisma.upstreamAccount.update({
          where: { id: acc.id },
          data: {
            accessToken: newToken,
            tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
          },
        });
      },
    },
  );
}
