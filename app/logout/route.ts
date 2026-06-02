import { signOut } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";

/** Clears the WorkOS session and redirects home (no-op in open demo mode). */
export async function GET() {
  if (!authEnabled()) redirect("/");
  await signOut({ returnTo: "/" });
}
