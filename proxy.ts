import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly "middleware"). Manages the WorkOS session so
 * `withAuth()` works in route handlers + server components. When WorkOS env is
 * absent the app runs in open demo mode → pass requests straight through.
 * Static assets are excluded (Tailwind v4 breaks under a catch-all matcher).
 */
const enabled = Boolean(
  process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
);

export default enabled
  ? authkitProxy()
  : (_request: NextRequest) => NextResponse.next();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
