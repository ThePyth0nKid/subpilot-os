import { runJs, withSandbox } from "@/lib/daytona/runner";

export interface ActionSandboxInput {
  readonly service: string;
  readonly fromCountry: string;
  readonly toCountry: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Scoped payment token (Stripe PaymentMethod id) — the ONLY secret that
   *  enters the sandbox. Never the raw PAN. Empty in pure dry-run. */
  readonly paymentToken?: string;
  readonly dryRun: boolean;
}

export interface ActionStep {
  readonly step: string;
  readonly detail: string;
}

export interface ActionSandboxOutput {
  readonly sandboxId: string;
  readonly steps: readonly ActionStep[];
  readonly giftCardSku: string;
  readonly tokenRedacted: string;
}

const MARKER = "__ACT__";

/** JS run INSIDE the sandbox: reads the scoped secret from its own env,
 *  performs the (dry-run) purchase steps, and prints a redacted result. */
const ACTION_SCRIPT = `
const order = JSON.parse(process.env.ORDER || '{}');
const token = process.env.PAYMENT_TOKEN || '';
const redacted = token
  ? token.slice(0, 6) + '…(' + token.length + ' chars, never leaves this sandbox)'
  : 'none (pure dry-run)';
const up = (s) => String(s || '').toUpperCase();
const steps = [
  { step: 'isolate', detail: 'Scoped payment token received in-sandbox: ' + redacted },
  { step: 'quote', detail: 'Quoted ' + order.service + ' gift card for region ' + up(order.to) },
  { step: order.dryRun ? 'simulate' : 'pay',
    detail: order.dryRun ? 'DRY RUN — no charge executed' : 'Charged via tokenized method (test mode)' },
  { step: 'redeem', detail: 'Provisioned ' + up(order.to) + ' account / gift-card code' },
  { step: 'cancel', detail: 'Old ' + up(order.from) + ' plan flagged for cancellation' },
];
const sku = 'BITREFILL-' + up(order.service) + '-' + up(order.to);
console.log('${MARKER}' + JSON.stringify({ steps, giftCardSku: sku, tokenRedacted: redacted }) + '${MARKER}');
`;

function parse(stdout: string, sandboxId: string): ActionSandboxOutput {
  const start = stdout.indexOf(MARKER);
  const end = stdout.indexOf(MARKER, start + MARKER.length);
  if (start === -1 || end === -1) {
    throw new Error("action sandbox produced no result marker");
  }
  const json = JSON.parse(stdout.slice(start + MARKER.length, end)) as Omit<
    ActionSandboxOutput,
    "sandboxId"
  >;
  return { ...json, sandboxId };
}

/**
 * Runs one switch inside an EPHEMERAL Daytona sandbox. The payment token is
 * injected via `envVars` (lives only in that sandbox), the automation runs,
 * and the sandbox is destroyed on teardown — credential isolation by design.
 */
export async function runActionInSandbox(
  input: ActionSandboxInput,
): Promise<ActionSandboxOutput> {
  const env = {
    ORDER: JSON.stringify({
      service: input.service,
      from: input.fromCountry,
      to: input.toCountry,
      amountMinor: input.amountMinor,
      currency: input.currency,
      dryRun: input.dryRun,
    }),
    PAYMENT_TOKEN: input.paymentToken ?? "",
  };

  return withSandbox(async (sb) => {
    const out = await runJs(sb, ACTION_SCRIPT);
    return parse(out.stdout, sb.id);
  }, env);
}
