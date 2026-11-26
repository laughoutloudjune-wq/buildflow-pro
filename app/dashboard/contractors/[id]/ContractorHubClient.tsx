'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Phone } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import { useUrlState } from '@/lib/use-url-state'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { getContractorApprovedHistory } from '@/actions/contractor-actions'
import { computeActualPayout } from '@/lib/billing'
import type { ContractorHubData } from '@/actions/construction-hubs'
import { useHubModal } from '@/components/construction/useHubModal'
import BillsPanel from '@/components/construction/BillsPanel'
import { MONEY, Tile, baht, fmtDateTime, pct } from '@/components/construction/vocab'

type Tab = 'jobs' | 'bills' | 'dc' | 'pay'
type PayRow = { id: string; docNo: string; kind: 'main' | 'dc'; paidAt: string; work: number; wht: number; retention: number; payout: number; project: string; plots: string }

const STATUS_LABEL: Record<string, string> = { pending: 'รอเริ่ม', in_progress: 'กำลังทำ', completed: 'เสร็จสิ้น' }
const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true })

export default function ContractorHubClient({ hub, canPay }: { hub: ContractorHubData; canPay: boolean }) {
  const { theme } = useDepartment()
  const hubModal = useHubModal()
  const [tab, setTab] = useUrlState<Tab>('tab', 'jobs', ['jobs', 'bills', 'dc', 'pay'] as const)
  const [projectFilter, setProjectFilter] = useUrlState<string>('project', '')
  const [openPlots, setOpenPlots] = useState<Set<string>>(new Set())
  const [pay, setPay] = useState<PayRow[] | null>(null)

  const projects = useMemo(() => [...new Map(hub.jobs.map((j) => [j.projectId, j.projectName])).entries()].sort((a, b) => byName(a[1], b[1])), [hub.jobs])
  const jobs = useMemo(() => hub.jobs.filter((j) => !projectFilter || j.projectId === projectFilter), [hub.jobs, projectFilter])

  const value = jobs.reduce((s, j) => s + j.value, 0)
  const billed = jobs.reduce((s, j) => s + j.paid, 0)
  const pendingOnJobs = jobs.reduce((s, j) => s + j.pending, 0)
  const bills = hub.bills.filter((b) => !projectFilter || b.projectId === projectFilter)
  const review = bills.filter((b) => b.status === 'pending_review')
  const toPay = bills.filter((b) => b.status === 'approved' && !b.paidOutAt)
  const dcApproved = bills.filter((b) => b.kind === 'dc' && b.status === 'approved').reduce((s, b) => s + b.workAmount, 0)

  const byPlot = useMemo(() => {
    const m = new Map<string, { key: string; project: string; plot: string; value: number; paid: number; pending: number; jobs: typeof jobs }>()
    for (const j of jobs) {
      const key = j.plotId
      const e = m.get(key) || { key, project: j.projectName, plot: j.plotName, value: 0, paid: 0, pending: 0, jobs: [] as typeof jobs }
      e.value += j.value
      e.paid += j.paid
      e.pending += j.pending
      e.jobs.push(j)
      m.set(key, e)
    }
    return [...m.values()].sort((a, b) => byName(a.project, b.project) || byName(a.plot, b.plot))
  }, [jobs])

  // Payout history loads when the tab opens (it reads every approved bill of this crew).
  useEffect(() => {
    if (tab !== 'pay' || pay) return
    let cancelled = false
    getContractorApprovedHistory(hub.contractor.id)
      .then((rows) => {
        if (cancelled) return
        setPay(
          (rows as Record<string, unknown>[])
            .filter((r) => r.paid_out_at)
            .map((r) => {
              const work = Number(r.total_work_amount || 0)
              const add = Number(r.total_add_amount || 0)
              const deduct = Number(r.total_deduct_amount || 0)
              const retention = r.retention_applied === false ? 0 : r.retention_amount != null ? Number(r.retention_amount) : work * (Number(r.retention_percent || 0) / 100)
              const wht = !r.wht_applied ? 0 : r.wht_amount != null ? Number(r.wht_amount) : (work + add - deduct) * (Number(r.wht_percent || 0) / 100)
              return {
                id: String(r.id),
                docNo: String(r.doc_no ?? '').padStart(4, '0'),
                kind: r.type === 'extra_work' ? ('dc' as const) : ('main' as const),
                paidAt: String(r.paid_out_at),
                work: work + add,
                wht,
                retention,
                payout: computeActualPayout(r as Parameters<typeof computeActualPayout>[0]),
                project: (r.projects as { name?: string } | null)?.name || '',
                plots: (r.plots as { name?: string | null } | null)?.name || '',
              }
            })
            .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        )
      })
      .catch(() => !cancelled && setPay([]))
    return () => {
      cancelled = true
    }
  }, [tab, pay, hub.contractor.id])

  const payTotal = (pay || []).reduce((s, r) => s + r.payout, 0)
  const retentionHeld = (pay || []).reduce((s, r) => s + r.retention, 0)
  const payHref = `/dashboard/billing?tab=pay&contractorId=${hub.contractor.id}`

  return (
    <PageContainer width="wide">
      <BackButton fallbackHref="/dashboard/contractors" label="ผู้รับเหมาทั้งหมด" />
      <PageHeader
        title={hub.contractor.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2 text-slate-500">
            {hub.contractor.typeName || 'ผู้รับเหมา'}
            {hub.contractor.phone && (
              <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" aria-hidden /> {hub.contractor.phone}</span>
            )}
          </span>
        }
        actions={
          canPay ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => hubModal.open(`/dashboard/billing/request?contractorId=${hub.contractor.id}`, `เบิกงวด · ${hub.contractor.name}`, true)}>เบิกงวด</Button>
              <Button size="sm" onClick={() => hubModal.open(payHref, `จ่ายเงิน · ${hub.contractor.name}`, true)}>จ่ายเงิน {toPay.length > 0 ? `(${toPay.length} ใบ)` : ''}</Button>
            </>
          ) : null
        }
      />

      {projects.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">โครงการ</span>
          {[['', 'ทั้งหมด'], ...projects].map(([id, name]) => (
            <button key={id || 'all'} type="button" aria-pressed={projectFilter === id} onClick={() => setProjectFilter(id)} className={`rounded-full border px-3 py-1 text-xs ${projectFilter === id ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="มูลค่างานที่ถือ" value={baht(value)} sub={`${jobs.length} งาน`} />
        <Tile label={MONEY.paid} value={baht(billed)} sub={value > 0 ? `${pct((billed / value) * 100)} ของมูลค่า` : undefined} />
        <Tile label={MONEY.left} value={baht(Math.max(0, value - billed - pendingOnJobs))} sub={pendingOnJobs > 0 ? `ยังไม่นับ ${baht(pendingOnJobs)} ที่รอตรวจ` : undefined} />
        <Tile label="ใบเบิก รอตรวจ · รอจ่าย" value={`${review.length} · ${toPay.length}`} sub={`รอจ่าย ${baht(toPay.reduce((s, b) => s + b.netAmount, 0))}`} tone={review.length > 0 ? 'amber' : 'default'} />
        <Tile label={MONEY.dc} value={baht(dcApproved)} />
      </div>

      <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="หมวดของผู้รับเหมา">
        {([['jobs', 'งานที่ถือ'], ['bills', 'ใบเบิกงานหลัก'], ['dc', 'งานเพิ่ม (DC)'], ['pay', 'การจ่ายเงิน & ประกัน']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${tab === key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'jobs' && (
        <Card className="overflow-hidden p-0">
          {byPlot.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">ยังไม่ได้ถืองานในโครงการ</p>
          ) : (
            <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-slate-500">
              <thead className="bg-slate-50">
                <tr className="text-right">
                  <th className="w-[34%] text-left">แปลง</th>
                  <th>{MONEY.contract}</th>
                  <th>{MONEY.paid}</th>
                  <th>{MONEY.left}</th>
                  <th className="max-md:hidden">รอตรวจ</th>
                </tr>
              </thead>
              <tbody>
                {byPlot.map((p) => {
                  const open = openPlots.has(p.key)
                  return (
                    <PlotRows key={p.key} linkClick={hubModal.click} open={open} onToggle={() => setOpenPlots((prev) => { const n = new Set(prev); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n })} p={p} projectId={p.jobs[0]?.projectId || ''} showProject={projects.length > 1} />
                  )
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-right font-semibold tabular-nums">
                  <td className="text-left">รวม</td>
                  <td>{baht(value)}</td>
                  <td>{baht(billed)}</td>
                  <td>{baht(Math.max(0, value - billed - pendingOnJobs))}</td>
                  <td className="max-md:hidden">{pendingOnJobs ? baht(pendingOnJobs) : '—'}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'bills' && <BillsPanel contractorId={hub.contractor.id} projectId={projectFilter || undefined} kind="main" showContractor={false} canReview={canPay} />}
      {tab === 'dc' && <BillsPanel contractorId={hub.contractor.id} projectId={projectFilter || undefined} kind="dc" showContractor={false} canReview={canPay} />}

      {tab === 'pay' && (
        <div className="space-y-3">
          {pay == null ? (
            <p className="text-sm text-slate-500">กำลังโหลด...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="จ่ายแล้วสะสม" value={baht(payTotal)} sub={`${pay.length} ใบ`} />
                <Tile label="เงินประกันผลงานที่หักไว้" value={baht(retentionHeld)} />
                <Tile label="รอจ่าย" value={baht(toPay.reduce((s, b) => s + b.netAmount, 0))} sub={`${toPay.length} ใบ`} />
                <div className="flex items-center">
                  {canPay && toPay.length > 0 && <Button onClick={() => hubModal.open(payHref, `จ่ายเงิน · ${hub.contractor.name}`, true)}>บันทึกจ่าย</Button>}
                </div>
              </div>
              <Card className="overflow-hidden p-0">
                {pay.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีการจ่ายเงิน</p>
                ) : (
                  <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-slate-500">
                    <thead className="bg-slate-50">
                      <tr className="text-right">
                        <th className="w-[20%] text-left">จ่ายเมื่อ</th>
                        <th className="w-[12%] text-left">เลขที่</th>
                        <th className="w-[10%] text-left">ประเภท</th>
                        <th>ยอดเบิก</th>
                        <th>หัก ณ ที่จ่าย</th>
                        <th>เงินประกัน</th>
                        <th>จ่ายจริง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pay.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 text-right tabular-nums">
                          <td className="text-left text-xs text-slate-600">{fmtDateTime(r.paidAt)}</td>
                          <td className="text-left font-medium text-indigo-700">#{r.docNo}</td>
                          <td className="text-left text-xs">{r.kind === 'dc' ? 'DC' : 'งานหลัก'}</td>
                          <td>{baht(r.work)}</td>
                          <td>{r.wht ? baht(r.wht) : '—'}</td>
                          <td>{r.retention ? baht(r.retention) : '—'}</td>
                          <td className="font-semibold">{baht(r.payout)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </div>
      )}
    {hubModal.node}
    </PageContainer>
  )
}

function PlotRows({ p, open, onToggle, projectId, showProject, linkClick }: { p: { key: string; project: string; plot: string; value: number; paid: number; pending: number; jobs: { id: string; name: string; status: string; value: number; paid: number; pending: number }[] }; open: boolean; onToggle: () => void; projectId: string; showProject: boolean; linkClick: (href: string, title: string) => (e: React.MouseEvent) => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-t border-slate-100 text-right tabular-nums hover:bg-slate-50">
        <td className="text-left">
          <Link href={`/dashboard/projects/${projectId}/${p.key}`} onClick={linkClick(`/dashboard/projects/${projectId}/${p.key}`, `แปลง ${p.plot}`)} className="font-semibold text-indigo-700 hover:underline">แปลง {p.plot}</Link>
          <span className="ml-2 text-xs text-slate-500">{showProject ? `${p.project} · ` : ''}{p.jobs.length} งาน {open ? '▾' : '▸'}</span>
        </td>
        <td>{baht(p.value)}</td>
        <td>{baht(p.paid)}</td>
        <td>{baht(Math.max(0, p.value - p.paid - p.pending))}</td>
        <td className="max-md:hidden">{p.pending ? baht(p.pending) : '—'}</td>
      </tr>
      {open &&
        p.jobs.map((j) => (
          <tr key={j.id} className="border-t border-slate-50 bg-slate-50/50 text-right text-xs tabular-nums">
            <td className="truncate pl-8 text-left text-slate-700" title={j.name}>{j.name} <span className="text-slate-400">· {STATUS_LABEL[j.status] || j.status}</span></td>
            <td>{baht(j.value)}</td>
            <td>{baht(j.paid)}</td>
            <td>{baht(Math.max(0, j.value - j.paid - j.pending))}</td>
            <td className="max-md:hidden">{j.pending ? baht(j.pending) : '—'}</td>
          </tr>
        ))}
    </>
  )
}
