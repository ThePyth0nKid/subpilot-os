import {
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { RunSnapshot } from "@/lib/orchestrator/types";

/** Users mirror the WorkOS identity (id = WorkOS user id). */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** One persisted optimization run + its full snapshot for history replay. */
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  status: text("status").notNull(),
  totalMonthlySavingsEUR: real("total_monthly_savings_eur").notNull().default(0),
  switchCount: integer("switch_count").notNull().default(0),
  snapshot: jsonb("snapshot").$type<RunSnapshot>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Tokenized payment method (Stripe) — never the raw PAN. */
export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
  brand: text("brand"),
  last4: text("last4"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
