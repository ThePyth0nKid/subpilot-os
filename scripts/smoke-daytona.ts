import "./_setup";
import { runJs, withSandbox } from "@/lib/daytona/runner";

async function main() {
  const t0 = Date.now();
  console.log("[smoke-daytona] creating sandbox + running code…");
  const result = await withSandbox(async (sb) => {
    console.log(`[smoke-daytona] sandbox id=${sb.id}`);
    return runJs(sb, "console.log('hi from daytona')");
  });
  const ms = Date.now() - t0;
  console.log(`[smoke-daytona] exitCode=${result.exitCode} stdout=${JSON.stringify(result.stdout.trim())} (${ms}ms incl. teardown)`);
  if (!result.stdout.includes("hi from daytona")) {
    throw new Error("expected stdout to contain 'hi from daytona'");
  }
  console.log("[smoke-daytona] OK");
}

main().catch((e) => {
  console.error("[smoke-daytona] FAILED:", e);
  process.exit(1);
});
