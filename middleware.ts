import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Verify the session locally instead of asking the Auth server to do it.
  // This project signs JWTs with an asymmetric key (ES256), so getClaims()
  // checks the signature against the cached JWKS with no network call -
  // unlike getSession(), which trusts the cookie blindly, and getUser(),
  // which was a full round trip to Supabase on *every* request this matcher
  // touches - measured at 145-306ms, added to each navigation and each RSC
  // prefetch.
  // getClaims() reads through getSession(), so an expiring token is still
  // refreshed and the rotated cookies are still written back below.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  const url = request.nextUrl.clone()
  const { pathname } = url

  if (pathname === '/') {
    url.pathname = user ? '/dashboard' : '/login'
    return NextResponse.redirect(url)
  }

  if (pathname === '/login' && user) {
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/dashboard') && !user) {
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - any file extension (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
