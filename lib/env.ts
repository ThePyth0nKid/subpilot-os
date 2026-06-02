import { z } from "zod";

/**
 * Typed, validated environment access.
 *
 * Real providers (keys present): Daytona, Anthropic, Tavily.
 * Mock providers (keys absent):  Bright Data, Bitrefill.
 *
 * Next.js auto-loads `.env.local` for the app. Standalone tsx scripts must
 * import `scripts/_setup.ts` first so dotenv populates `process.env`.
 */
const optional = z
  .string()
  .transform((s) => (s && s.trim().length > 0 ? s : undefined))
  .optional();

const EnvSchema = z.object({
  // Required (real services)
  DAYTONA_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TAVILY_API_KEY: z.string().min(1),
  // Optional (mock until provided)
  BRIGHTDATA_HOST: optional,
  BRIGHTDATA_PORT: optional,
  BRIGHTDATA_USERNAME: optional,
  BRIGHTDATA_PASSWORD: optional,
  BITREFILL_API_KEY: optional,
  BITREFILL_API_SECRET: optional,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(
      `Missing/invalid environment variables: ${missing}. ` +
        `Add them to .env.local (see .env.example). ` +
        `Required: DAYTONA_API_KEY, ANTHROPIC_API_KEY, TAVILY_API_KEY.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** True when a real Bright Data residential proxy is configured. */
export function hasBrightData(env: Env): boolean {
  return Boolean(
    env.BRIGHTDATA_HOST &&
      env.BRIGHTDATA_PORT &&
      env.BRIGHTDATA_USERNAME &&
      env.BRIGHTDATA_PASSWORD,
  );
}

/** True when real Bitrefill credentials are configured. */
export function hasBitrefill(env: Env): boolean {
  return Boolean(env.BITREFILL_API_KEY && env.BITREFILL_API_SECRET);
}
