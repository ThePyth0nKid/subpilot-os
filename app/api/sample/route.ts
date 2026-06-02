import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/** Serves the bundled demo bank statement for the "Try demo" button. */
export async function GET() {
  try {
    const file = path.join(process.cwd(), "fixtures", "sample-bank-statement.csv");
    const csv = await readFile(file, "utf8");
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch {
    return new Response("Sample not found", { status: 404 });
  }
}
