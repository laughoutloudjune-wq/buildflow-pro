import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  // สำคัญ: ต้องมี await ตรงนี้ เพื่อรอให้ได้ cookie store จริงๆ ออกมา
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // กรณีเรียก setAll จาก Server Component (ซึ่งทำไม่ได้) ให้ปล่อยผ่าน
          }
        },
      },
    }
  )
}