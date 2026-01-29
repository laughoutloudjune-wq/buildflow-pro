import { login, signup } from './actions' // เดี๋ยวเราสร้างไฟล์ action แยก

export default function LoginPage() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-100">
      <form className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">BuildFlow Pro 🏗️</h1>
          <p className="text-sm text-slate-500">เข้าสู่ระบบเพื่อจัดการงานก่อสร้าง</p>
        </div>
        
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
            placeholder="••••••••"
            className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
          />
        </div>

        <div className="flex gap-2 pt-2">
          {/* ปุ่ม Login */}
          <button formAction={login} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition">
            เข้าสู่ระบบ
          </button>
          
          {/* ปุ่ม Sign up (ถ้าจะเปิดให้สมัคร) */}
          <button formAction={signup} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            สมัครสมาชิก
          </button>
        </div>
      </form>
    </div>
  )
}