import { handleAuth } from "@workos-inc/authkit-nextjs";

/** WorkOS AuthKit OAuth callback (must match NEXT_PUBLIC_WORKOS_REDIRECT_URI). */
export const GET = handleAuth();
