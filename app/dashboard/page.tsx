'use client'

import { useEffect, useState } from 'react'
import { Building2, Home, Wallet, Activity, TrendingUp, Clock, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { getDashboardStats } from '@/actions/dashboard-actions'
import { formatCurrency } from '@/lib/currency'

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const data = await getDashboardStats()
        setStats(data)
      } catch (error) {
        console.error(error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-slate-400">
        <Activity className="h-8 w-8 animate-pulse text-indigo-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-800">ภาพรวมโครงการ</h1>
        <p className="text-slate-500">สรุปสถานะงานก่อสร้างและการเงินทั้งหมดของคุณ</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard 
          title="โครงการทั้งหมด" 
          value={stats.projectCount} 
          icon={<Building2 className="h-6 w-6 text-blue-600" />}
          bg="bg-blue-50"
          desc="โครงการที่กำลังดำเนินการ"
        />
        <StatsCard 
          title="แปลงที่ดิน" 
          value={stats.plotCount} 
          icon={<Home className="h-6 w-6 text-indigo-600" />}
          bg="bg-indigo-50"
          desc="บ้านที่กำลังก่อสร้าง"
        />
        <StatsCard 
          title="งานกำลังทำ" 
          value={stats.activeJobs} 
          icon={<Activity className="h-6 w-6 text-amber-600" />}
          bg="bg-amber-50"
          desc="รายการงานที่ช่างกำลังทำ"
        />
        <StatsCard 
          title="จ่ายเงินแล้ว" 
          value={`฿${formatCurrency(stats.totalPaid)}`} 
          icon={<Wallet className="h-6 w-6 text-emerald-600" />}
          bg="bg-emerald-50"
          desc="ยอดรวมรายจ่ายทั้งหมด"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left: Quick Menu */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-600"/> ทางลัดจัดการงาน
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
             <Link href="/dashboard/projects">
                <div className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-md cursor-pointer">
                  <div className="rounded-lg bg-blue-100 p-3 text-blue-600">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-700 group-hover:text-indigo-600">จัดการโครงการ</h3>
                    <p className="text-sm text-slate-500">ดูความคืบหน้าแต่ละโครงการ</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-300 group-hover:text-indigo-500" />
                </div>
             </Link>

             <Link href="/dashboard/boq">
                <div className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-md cursor-pointer">
                  <div className="rounded-lg bg-purple-100 p-3 text-purple-600">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-700 group-hover:text-indigo-600">แบบบ้าน & BOQ</h3>
                    <p className="text-sm text-slate-500">จัดการราคากลางและแบบ</p>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-300 group-hover:text-indigo-500" />
                </div>
             </Link>
          </div>
        </div>

        {/* Right: Recent Transactions */}
        <div>
          <h2 className="mb-4 text-lg font-bold text-slate-800 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-500"/> รายการจ่ายล่าสุด
          </h2>
          <Card className="divide-y divide-slate-100">
            {stats.recentPayments.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">ยังไม่มีรายการจ่ายเงิน</div>
            ) : (
                stats.recentPayments.map((pay: any) => (
                <div key={pay.id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition">
                    <div>
                    <p className="font-bold text-slate-800">฿{formatCurrency(pay.amount)}</p>
                    <p className="text-xs text-slate-500 truncate w-[150px]">
                        {pay.job_assignments?.plots?.name} ({pay.job_assignments?.plots?.projects?.name})
                    </p>
                    </div>
                    <div className="text-right">
                    <span className="block text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                        จ่ายแล้ว
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                        {new Date(pay.created_at).toLocaleDateString('th-TH')}
                    </span>
                    </div>
                </div>
                ))
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// Component ย่อยสำหรับ Card สถิติ
function StatsCard({ title, value, icon, bg, desc }: any) {
  return (
    <Card className="p-0 overflow-hidden border-none shadow-sm ring-1 ring-slate-200">
      <div className="p-5">
        <div className="flex items-center gap-4">
          <div className={`rounded-xl p-3 ${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">{title}</p>
            <h3 className="text-2xl font-bold text-slate-800">{value}</h3>
          </div>
        </div>
        <div className="mt-4 border-t pt-3">
            <p className="text-xs text-slate-400">{desc}</p>
        </div>
      </div>
    </Card>
  )
}
