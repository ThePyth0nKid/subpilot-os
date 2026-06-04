import type { ProxyConfig } from "@/lib/providers";
import {
  runShell,
  withSandbox,
  type SandboxNetwork,
} from "@/lib/daytona/runner";
import { proxyShell } from "@/lib/daytona/proxy-shell";
import { redactToken } from "@/lib/verify/redact";
import type { ActionStep } from "@/lib/daytona/action-sandbox";

export interface CancelSandboxInput {
  readonly service: string;
  readonly fromCountry: string;
  readonly sessionToken: string; // old-account cookie (secret)
  readonly proxy: ProxyConfig;
  readonly dryRun: boolean;
  readonly network?: SandboxNetwork;
}

export interface CancelSandboxOutput {
  readonly sandboxId: string;
  readonly egressCountry?: string;
  readonly twoFaRequired: boolean;
  readonly tokenRedacted: string;
  readonly steps: readonly ActionStep[];
}

/** Pull the first {...} JSON object out of possibly-noisy stdout. */
function firstJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start !== -1 && end > start ? s.slice(start, end + 1) : "";
}

/**
 * Cancel the OLD subscription inside an ephemeral sandbox. Mirrors
 * verify-sandbox: cookie only as `$SP_COOKIE`, `proxyShell` CONNECT flags (C4),
 * egress allowlist (C3), teardown on finish.
 *
 * DRY-RUN (the only path implemented in Stage 2): runs an egress-proof GET and
 * emits `simulate` steps — it performs NO cancellation POST and never mutates
 * the account. Success of a real cancel is NEVER inferred from an HTTP status;
 * the truth comes from the subsequent `verifyCancel` re-probe. The live branch
 * (likely Playwright in the sandbox image) is a gated Stage-2 milestone.
 */
export async function runCancelInSandbox(
  input: CancelSandboxInput,
): Promise<CancelSandboxOutput> {
  if (!input.dryRun) {
    throw new Error(
      "live cancellation is not implemented — Stage-2 milestone (needs a browser " +
        "runtime in the sandbox image; cancel is dry-run-only until then).",
    );
  }
  const px = proxyShell(input.proxy);
  const tokenRedacted = redactToken(input.sessionToken);

  return withSandbox(
    async (sb): Promise<CancelSandboxOutput> => {
      const steps: ActionStep[] = [];
      let egressCountry: string | undefined;
      try {
        const geo = await runShell(
          sb,
          `curl -s --max-time 20 ${px.flags} https://geo.brdtest.com/mygeo.json`,
          px.env,
          30,
        );
        const parsed = JSON.parse(firstJsonObject(geo.stdout)) as {
          country?: string;
          geo?: { country?: string };
        };
        egressCountry = (parsed.country ?? parsed.geo?.country ?? "").toUpperCase();
      } catch {
        /* egress is best-effort evidence */
      }
      steps.push({
        step: "egress",
        detail: egressCountry
          ? `Egress ${egressCountry} via ${input.proxy.mode}`
          : `Egress inconclusive via ${input.proxy.mode}`,
      });
      steps.push({
        step: "simulate",
        detail: "DRY RUN — cancellation flow NOT executed (no POST, no mutation)",
      });
      steps.push({
        step: "redact",
        detail: `Old session token isolated in sandbox: ${tokenRedacted}`,
      });
      return {
        sandboxId: sb.id,
        egressCountry,
        twoFaRequired: false,
        tokenRedacted,
        steps,
      };
    },
    undefined,
    input.network,
  );
}
