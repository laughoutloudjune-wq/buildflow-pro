import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { signup } from '@/app/login/actions'

type RegisterPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = (await searchParams) || {}
  const error = typeof params.error === 'string' ? params.error : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4">
      <form className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200/70 bg-white/90 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.12)] backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-indigo-600 shadow-[0_4px_12px_-2px_rgba(79,70,229,0.5)]">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">สมัครใช้งาน BuildFlow Pro</h1>
          <p className="mt-1 text-sm text-slate-500">กรอกข้อมูลเพื่อสร้างบัญชีผู้ใช้</p>
        </div>

        {error ? <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-600">ชื่อผู้ใช้</label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            placeholder="เช่น สมชาย ใจดี"
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-600">อีเมล</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-600">รหัสผ่าน</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="อย่างน้อย 6 ตัวอักษร"
            className="w-full"
          />
        </div>

        <Button formAction={signup} className="w-full">
          ลงทะเบียน
        </Button>

        <div className="text-center text-sm text-slate-500">
          มีบัญชีแล้ว?{' '}
          <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
            กลับไปเข้าสู่ระบบ
          </Link>
        </div>
      </form>
    </div>
  )
}
