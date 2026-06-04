import { redactCsvText } from "@/lib/anonymize";
import { pdfStatementToCsv } from "./pdf";

const MAX_UPLOAD_BYTES = 10_000_000; // 10 MB — guards against OOM on a huge upload

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * Read an uploaded bank statement (CSV text OR a PDF) into the canonical CSV the
 * ingest pipeline parses. A PDF is extracted + redacted server-side here, so its
 * raw PII never reaches a log, the LLM, or persistence. CSV text is passed
 * through unchanged (the pipeline anonymizes it at parse time).
 */
export async function readStatement(req: Request): Promise<string> {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (file instanceof File) {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error("File too large (max 10 MB).");
      }
      if (isPdf(file)) {
        return await pdfStatementToCsv(new Uint8Array(await file.arrayBuffer()));
      }
      // A CSV arriving as a multipart FILE skipped the browser-side redaction —
      // redact immediately so this path upholds the same invariant.
      return redactCsvText(await file.text());
    }
    const csv = form.get("csv");
    if (typeof csv === "string") return csv;
    throw new Error("multipart body missing `file` or `csv` field");
  }

  const text = await req.text();
  if (ct.includes("application/json") || text.trimStart().startsWith("{")) {
    const body = JSON.parse(text) as { csv?: string };
    if (!body.csv) throw new Error("JSON body missing `csv` field");
    return body.csv;
  }
  return text;
}
