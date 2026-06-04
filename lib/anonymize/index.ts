/**
 * Anonymization boundary — the single shared, PURE, browser-safe module that
 * strips PII from bank-statement data BEFORE any processing, LLM call, log,
 * SSE payload, or DB write.
 *
 * Defense order: (1) PROJECT a row to { date, merchant, amountMinor, currency }
 * — every PII-bearing column is dropped; (2) REDACT the one free-text field;
 * (3) ASSERT no PII at each trust boundary as a fail-closed backstop.
 *
 * Imported identically by the browser (pre-upload, `redactCsvText`) and the
 * server (ingest parse boundary + the assertNoPII guards).
 */
export { RawTxnSchema, type RawTxn, projectRow } from "./raw-txn";
export {
  redactMerchant,
  redactCsvText,
  redactRawTxn,
  projectAndRedact,
  assertNoPII,
  hasPII,
  type RedactOptions,
} from "./redact";
export { parseHolderNames, REDACTION_PLACEHOLDER_WORDS } from "./rules";
