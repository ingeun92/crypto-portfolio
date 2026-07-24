import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

// /api/upbit/sync is machine-to-machine (the fixed-IP worker has no session
// cookie); it guards itself with a Bearer secret, same as /api/cron.
const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/cron", "/api/upbit/sync"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.AUTH_SECRET ?? "";
  const ok = secret ? await verifyToken(token, secret) : false;
  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
