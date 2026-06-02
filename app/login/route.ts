import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";

/** Initiates the WorkOS AuthKit sign-in flow (no-op in open demo mode). */
export async function GET() {
  if (!authEnabled()) redirect("/");
  const signInUrl = await getSignInUrl();
  redirect(signInUrl);
}
