import { signOut } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";

/** Canonical app origin — absolute so logout doesn't resolve to the container
 *  host (:8080) behind the proxy. Same fix as the callback's baseURL. */
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
const appHome = redirectUri ? `${new URL(redirectUri).origin}/` : "/";

/** Clears the WorkOS session and redirects home (no-op in open demo mode). */
export async function GET() {
  if (!authEnabled()) redirect("/");
  await signOut({ returnTo: appHome });
}
