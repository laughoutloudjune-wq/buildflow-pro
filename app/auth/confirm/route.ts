import type { EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Handles Supabase's token_hash-style auth links (invite, recovery) - the
// email points here, this verifies the token server-side (establishing the
// session via cookies) and hands off to whatever page needs it next. The
// older hash-fragment link style (#access_token=...) never reaches a server
// route at all, since fragments aren't sent in HTTP requests - that style
// is handled client-side instead, by the browser Supabase client's own
// auto-detection (see lib/supabase/client.ts and app/set-password/page.tsx).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // L-03: only a same-site path is a valid redirect target - `next=//evil.
  // example` or `next=https://evil.example` would otherwise send someone to
  // another origin right after a real login link is used. A single leading
  // "/" (and not "//", which the browser also treats as protocol-relative)
  // is the only shape accepted.
  const rawNext = searchParams.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/set-password'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว')}`)
}
