import { NextRequest, NextResponse } from "next/server";

/**
 * Legacy deep-links predate the landing page: `/?session=…&project=…` moved to
 * `/atlas` with the query intact. Share links `/s/[token]` are untouched.
 */
export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  if (url.pathname === "/" && url.searchParams.has("session")) {
    url.pathname = "/atlas";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
