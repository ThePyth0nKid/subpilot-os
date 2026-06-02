import "server-only";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";

/** Shape accepted by `AuthKitProvider`'s `initialAuth` (access token stripped). */
export type InitialAuth = Omit<UserInfo | NoUserInfo, "accessToken">;

/**
 * Auth helpers with graceful degradation: when WorkOS env is absent the app
 * runs in open "demo" mode (no gate). Reads `process.env` directly so it works
 * in both the Edge proxy and Node route handlers without the env cache.
 */
export function authEnabled(): boolean {
  return Boolean(
    process.env.WORKOS_API_KEY &&
      process.env.WORKOS_CLIENT_ID &&
      process.env.WORKOS_COOKIE_PASSWORD,
  );
}

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
}

/** Current signed-in user, or null (also null when auth is disabled). */
export async function getUser(): Promise<SessionUser | null> {
  if (!authEnabled()) return null;
  try {
    const { user } = await withAuth();
    return user
      ? { id: user.id, email: user.email, firstName: user.firstName ?? null }
      : null;
  } catch (err) {
    // Surface infra failures instead of silently degrading to "guest".
    console.error(
      "[auth] withAuth failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Server-resolved auth for `AuthKitProvider initialAuth` — strips the access
 * token so it never reaches the browser. `{ user: null }` when disabled.
 */
export async function getInitialAuth(): Promise<InitialAuth> {
  if (!authEnabled()) return { user: null };
  try {
    const { accessToken: _drop, ...rest } = await withAuth();
    return rest;
  } catch {
    return { user: null };
  }
}
