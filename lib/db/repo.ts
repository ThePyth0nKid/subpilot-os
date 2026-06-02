import { desc, eq } from "drizzle-orm";
import type { RunSnapshot } from "@/lib/orchestrator/types";
import { getDb } from "./client";
import { paymentMethods, runs, users } from "./schema";

/** Mirror the WorkOS identity locally (best-effort, no-op without a DB). */
export async function upsertUser(id: string, email: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.insert(users).values({ id, email }).onConflictDoNothing();
}

/** Persist a completed run + snapshot (no-op without a DB). */
export async function persistRun(args: {
  readonly id: string;
  readonly userId?: string | null;
  readonly snapshot: RunSnapshot;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(runs)
    .values({
      id: args.id,
      userId: args.userId ?? null,
      status: "done",
      totalMonthlySavingsEUR: args.snapshot.report.totalMonthlySavingsEUR,
      switchCount: args.snapshot.report.switchCount,
      snapshot: args.snapshot,
    })
    .onConflictDoNothing();
}

export interface RunListItem {
  readonly id: string;
  readonly createdAt: string;
  readonly totalMonthlySavingsEUR: number;
  readonly switchCount: number;
}

/** Most-recent runs for a user (empty without a DB). */
export async function listRuns(
  userId: string,
  limit = 20,
): Promise<readonly RunListItem[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: runs.id,
      createdAt: runs.createdAt,
      totalMonthlySavingsEUR: runs.totalMonthlySavingsEUR,
      switchCount: runs.switchCount,
    })
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    totalMonthlySavingsEUR: r.totalMonthlySavingsEUR,
    switchCount: r.switchCount,
  }));
}

export interface SavedPaymentMethod {
  readonly stripeCustomerId: string;
  readonly stripePaymentMethodId: string;
  readonly brand: string | null;
  readonly last4: string | null;
}

/** One tokenized card per user (replaces any prior one). No-op without a DB. */
export async function savePaymentMethod(
  userId: string,
  pm: SavedPaymentMethod,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.delete(paymentMethods).where(eq(paymentMethods.userId, userId));
  await db.insert(paymentMethods).values({
    userId,
    stripeCustomerId: pm.stripeCustomerId,
    stripePaymentMethodId: pm.stripePaymentMethodId,
    brand: pm.brand,
    last4: pm.last4,
  });
}

export async function getPaymentMethod(
  userId: string,
): Promise<SavedPaymentMethod | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .limit(1);
  const r = rows[0];
  return r
    ? {
        stripeCustomerId: r.stripeCustomerId,
        stripePaymentMethodId: r.stripePaymentMethodId,
        brand: r.brand,
        last4: r.last4,
      }
    : null;
}
