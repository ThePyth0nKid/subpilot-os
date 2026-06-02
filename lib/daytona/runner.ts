import { Daytona } from "@daytonaio/sdk";
import { loadEnv } from "@/lib/env";

/** A live Daytona sandbox handle (inferred to track SDK changes). */
export type Sandbox = Awaited<ReturnType<Daytona["create"]>>;

export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
}

let client: Daytona | null = null;
function daytona(): Daytona {
  if (!client) client = new Daytona({ apiKey: loadEnv().DAYTONA_API_KEY });
  return client;
}

/**
 * Create an isolated TypeScript/JS sandbox. Optional `envVars` are injected
 * into the sandbox process only — used to hand a scoped secret (e.g. a geo
 * proxy credential or a single-use payment token) to the code running inside,
 * never persisted by the kernel. The sandbox is destroyed on teardown.
 */
export async function createSandbox(
  envVars?: Readonly<Record<string, string>>,
): Promise<Sandbox> {
  return daytona().create({
    language: "typescript",
    ...(envVars ? { envVars: { ...envVars } } : {}),
  });
}

/** Run a JS/TS snippet inside the sandbox and collect stdout. */
export async function runJs(sandbox: Sandbox, code: string): Promise<RunResult> {
  const res = await sandbox.process.codeRun(code);
  const stdout = (res.result ?? res.artifacts?.stdout ?? "").toString();
  return { exitCode: res.exitCode ?? 0, stdout };
}

/**
 * Run a shell command inside the sandbox and collect stdout — the real-work
 * primitive (e.g. `curl --proxy <country-ip> <pricing-url>` for geo research).
 * `env` passes per-command variables (kept out of the kernel's process).
 */
export async function runShell(
  sandbox: Sandbox,
  command: string,
  env?: Readonly<Record<string, string>>,
  timeoutSec = 60,
): Promise<RunResult> {
  const res = await sandbox.process.executeCommand(
    command,
    undefined,
    env ? { ...env } : undefined,
    timeoutSec,
  );
  const stdout = (res.result ?? res.artifacts?.stdout ?? "").toString();
  return { exitCode: res.exitCode ?? 0, stdout };
}

/** Best-effort teardown — never throws (cleanup must not fail a run). */
export async function teardown(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.delete();
  } catch {
    /* sandbox already gone / transient — ignore on teardown */
  }
}

/** Create → use → always tear down. */
export async function withSandbox<R>(
  fn: (sandbox: Sandbox) => Promise<R>,
): Promise<R> {
  const sandbox = await createSandbox();
  try {
    return await fn(sandbox);
  } finally {
    await teardown(sandbox);
  }
}

export interface FanOutOptions {
  readonly concurrency?: number;
}

/**
 * Concurrency-limited fan-out. Each item runs through `worker` independently;
 * a worker that throws yields `null` for that slot (the caller filters/handles).
 * Workers own sandbox lifecycle + event emission so this stays a pure pool.
 */
export async function fanOut<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: FanOutOptions = {},
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;

  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }

  const lanes = Math.max(1, Math.min(opts.concurrency ?? 5, items.length || 1));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
