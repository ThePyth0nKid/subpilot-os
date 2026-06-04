import { handleAuth } from "@workos-inc/authkit-nextjs";

/**
 * WorkOS AuthKit OAuth callback (must match NEXT_PUBLIC_WORKOS_REDIRECT_URI).
 *
 * `baseURL` is REQUIRED behind a proxy/container: Railway runs `next start` on
 * an internal port (:8080), so the incoming request URL the app sees is
 * `localhost:8080`, not the public origin. Without baseURL, authkit redirects
 * the user there after login. We derive the canonical origin from the
 * configured redirect URI so it's correct for both local and prod.
 */
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined;

export const GET = handleAuth(baseURL ? { baseURL } : {});
