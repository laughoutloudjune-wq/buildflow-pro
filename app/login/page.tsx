import Link from 'next/link'
import { login } from './actions'

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) || {}
  const error = typeof params.error === 'string' ? params.error : ''
  const success = typeof params.success === 'string' ? params.success : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">BuildFlow Pro</h1>
          <p className="text-sm text-slate-500">เข้าสู่ระบบเพื่อใช้งาน</p>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {success ? <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div> : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">อีเมล</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="admin@example.com"
            className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">รหัสผ่าน</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            placeholder="อย่างน้อย 6 ตัวอักษร"
            className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <button formAction={login} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition">
          เข้าสู่ระบบ
        </button>

        <div className="text-center text-sm text-slate-600">
          ยังไม่มีบัญชี?{' '}
          <Link href="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
            ลงทะเบียน
          </Link>
        </div>
      </form>
    </div>
  )
}
