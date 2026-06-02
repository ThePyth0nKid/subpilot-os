/**
 * Side-effect import for standalone tsx scripts: loads `.env.local` into
 * `process.env` before any module that reads env is evaluated.
 *
 * Usage: make this the FIRST import in every script.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
