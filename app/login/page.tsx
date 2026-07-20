import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { login } from './actions'

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) || {}
  const error = typeof params.error === 'string' ? params.error : ''
  const success = typeof params.success === 'string' ? params.success : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4">
      <form className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200/70 bg-white/90 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.12)] backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-indigo-600 shadow-[0_4px_12px_-2px_rgba(79,70,229,0.5)]">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">BuildFlow Pro</h1>
          <p className="mt-1 text-sm text-slate-500">เข้าสู่ระบบเพื่อใช้งาน</p>
        </div>

        {error ? <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-slate-600">
            อีเมล
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="admin@example.com"
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-600">
            รหัสผ่าน
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            placeholder="อย่างน้อย 6 ตัวอักษร"
            className="w-full"
          />
        </div>

        <Button formAction={login} className="w-full">
          เข้าสู่ระบบ
        </Button>

        <div className="text-center text-sm text-slate-500">
          ยังไม่มีบัญชี?{' '}
          <Link href="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
            ลงทะเบียน
          </Link>
        </div>
      </form>
    </div>
  )
}
