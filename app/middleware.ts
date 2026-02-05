import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
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
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // 1. เช็คว่ามี User ไหม (สำคัญมาก: ต้องใช้ getUser ไม่ใช่ getSession เพื่อความชัวร์ทาง Server)
  const { data: { user } } = await supabase.auth.getUser()

  const url = request.nextUrl.clone()

  // 2. ถ้าเข้าหน้า Root (/)
  if (url.pathname === '/') {
    // ถ้ามี User -> ไป Dashboard
    if (user) {
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
    // ถ้าไม่มี -> ไป Login
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // 3. ถ้าเข้าหน้า Login (/login) แล้วมี User อยู่แล้ว -> ดีดไป Dashboard (ไม่ต้อง login ซ้ำ)
  if (url.pathname === '/login' && user) {
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // 4. ถ้าเข้าหน้า Dashboard (/dashboard) แต่ไม่มี User -> ดีดไป Login
  if (url.pathname.startsWith('/dashboard') && !user) {
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // refresh session
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
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}