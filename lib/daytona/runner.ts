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

/** Create an isolated TypeScript/JS sandbox. */
export async function createSandbox(): Promise<Sandbox> {
  return daytona().create({ language: "typescript" });
}

/** Run a JS/TS snippet inside the sandbox and collect stdout. */
export async function runJs(sandbox: Sandbox, code: string): Promise<RunResult> {
  const res = await sandbox.process.codeRun(code);
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
