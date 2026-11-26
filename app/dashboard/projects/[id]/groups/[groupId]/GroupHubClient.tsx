'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { BackButton } from '@/components/ui/BackButton'
import { useUrlState } from '@/lib/use-url-state'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { getScopeBills, type GroupHubData, type GroupHubJob, type ScopeBill } from '@/actions/construction-hubs'
import type { getCostBoard } from '@/actions/procurement/cost-board'
import BillsPanel from '@/components/construction/BillsPanel'
import { useHubModal } from '@/components/construction/useHubModal'
import BoqScopeTab from '@/components/construction/BoqScopeTab'
import { MONEY, Tile, baht, pct } from '@/components/construction/vocab'

type Board = Awaited<ReturnType<typeof getCostBoard>>
type Tab = 'plots' | 'jobs' | 'bills' | 'dc' | 'boq' | 'cost'

const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true })

type Cell = 'done' | 'doing' | 'todo' | 'alert' | 'none'
function cellOf(j: GroupHubJob | undefined): Cell {
  if (!j) return 'none'
  if (j.value > 0 && j.paid >= j.value - 0.005 && j.status !== 'completed') return 'alert'
  if (j.status === 'completed') return 'done'
  if (j.status === 'in_progress') return 'doing'
  return 'todo'
}
const CELL_SYMBOL: Record<Cell, { ch: string; cls: string; label: string }> = {
  done: { ch: '✓', cls: 'text-emerald-600', label: 'เสร็จสิ้น' },
  doing: { ch: '◐', cls: 'text-blue-600', label: 'กำลังทำ' },
  todo: { ch: '·', cls: 'text-slate-400', label: 'รอเริ่ม' },
  alert: { ch: '!', cls: 'rounded bg-red-100 font-bold text-red-700', label: 'จ่ายครบแล้วแต่ยังไม่เสร็จ' },
  none: { ch: '–', cls: 'text-slate-300', label: 'ไม่มีงานนี้ในแบบบ้านนี้' },
}

export default function GroupHubClient({ hub, board, canSeeLabor, canBoq, canReview }: { hub: GroupHubData; board: Board | null; canSeeLabor: boolean; canBoq: boolean; canReview: boolean }) {
    const plotModal = useHubModal()
  const { theme } = useDepartment()
  const projectId = hub.group.projectId
  const [tab, setTab] = useUrlState<Tab>('tab', 'plots', ['plots', 'jobs', 'bills', 'dc', 'boq', 'cost'] as const)
  // '' = the whole batch, otherwise one plot id.
  const [plotChip, setPlotChip] = useUrlState<string>('plot', '')

  const scopePlots = useMemo(() => (plotChip ? hub.plots.filter((p) => p.id === plotChip) : hub.plots), [hub.plots, plotChip])
  const scopeIds = useMemo(() => scopePlots.map((p) => p.id), [scopePlots])
  const scopeJobs = useMemo(() => hub.jobs.filter((j) => scopeIds.includes(j.plotId)), [hub.jobs, scopeIds])
  const boardRows = useMemo(() => (board?.rows || []).filter((r) => scopeIds.includes(r.plotId)), [board, scopeIds])

  // DC approved total for the tile (bills of this batch, kept apart from main bills).
  const [bills, setBills] = useState<{ key: string; rows: ScopeBill[] } | null>(null)
  const billsKey = hub.plots.map((p) => p.id).join(',')
  useEffect(() => {
    if (!canSeeLabor || !billsKey) return
    let cancelled = false
    getScopeBills({ projectId, plotIds: billsKey.split(',') })
      .then((rows) => !cancelled && setBills({ key: billsKey, rows }))
      .catch(() => !cancelled && setBills({ key: billsKey, rows: [] }))
    return () => {
      cancelled = true
    }
  }, [projectId, billsKey, canSeeLabor])

  const contract = scopeJobs.reduce((s, j) => s + j.value, 0)
  const paid = scopeJobs.reduce((s, j) => s + j.paid, 0)
  const dcApproved = bills?.key === billsKey ? bills.rows.filter((b) => b.kind === 'dc' && b.status === 'approved' && b.plotIds.some((id) => scopeIds.includes(id))).reduce((s, b) => s + b.workAmount, 0) : null
  const materialUsed = boardRows.reduce((s, r) => s + r.materialUsed, 0)
  const doneCount = scopeJobs.filter((j) => j.status === 'completed').length
  const alerts = scopeJobs.filter((j) => cellOf(j) === 'alert')

  const at = hub.siblings.findIndex((g) => g.id === hub.group.id)
  const prev = at > 0 ? hub.siblings[at - 1] : null
  const next = at >= 0 && at < hub.siblings.length - 1 ? hub.siblings[at + 1] : null

  // Job x plot grid: one row per job name (the two "Prime A" codes merge by name), by trade.
  const grid = useMemo(() => {
    const byJob = new Map<string, { name: string; trade: string; cells: Map<string, GroupHubJob>; crews: Set<string> }>()
    for (const j of scopeJobs) {
      const key = `${j.trade}||${j.name}`
      const row = byJob.get(key) || { name: j.name, trade: j.trade, cells: new Map<string, GroupHubJob>(), crews: new Set<string>() }
      row.cells.set(j.plotId, j)
      if (j.contractorName) row.crews.add(j.contractorName)
      byJob.set(key, row)
    }
    const rows = [...byJob.values()].sort((a, b) => byName(a.trade, b.trade) || byName(a.name, b.name))
    const trades = new Map<string, typeof rows>()
    for (const r of rows) trades.set(r.trade, [...(trades.get(r.trade) || []), r])
    return [...trades.entries()]
  }, [scopeJobs])

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'plots', label: 'แปลงในกลุ่ม', show: true },
    { key: 'jobs', label: 'งานและช่าง', show: true },
    { key: 'bills', label: 'ใบเบิก', show: canSeeLabor },
    { key: 'dc', label: 'งานเพิ่ม (DC)', show: canSeeLabor },
    { key: 'boq', label: 'วัสดุ BOQ', show: canBoq },
    { key: 'cost', label: 'ต้นทุน', show: canSeeLabor },
  ]

  return (
    <PageContainer width="wide">
      <BackButton fallbackHref={`/dashboard/projects/${projectId}/board`} label="กลับ" />
      <PageHeader
        title={`กลุ่ม ${hub.group.name}`}
        subtitle={`${hub.group.projectName} · ${hub.plots.length} แปลง · งานเสร็จ ${doneCount}/${scopeJobs.length}`}
        actions={
          <>
            {prev && (
              <Link href={`/dashboard/projects/${projectId}/groups/${prev.id}?tab=${tab}`} className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                <ChevronLeft className="h-4 w-4" aria-hidden /> {prev.name}
              </Link>
            )}
            {next && (
              <Link href={`/dashboard/projects/${projectId}/groups/${next.id}?tab=${tab}`} className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                {next.name} <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </>
        }
      />

      {/* Scope chips: the same tab, for the whole batch or one plot. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">ดูของ</span>
        {[{ id: '', name: 'ทั้งกลุ่ม' }, ...hub.plots].map((p) => (
          <button key={p.id || 'all'} type="button" aria-pressed={plotChip === p.id} onClick={() => setPlotChip(p.id)} className={`rounded-full border px-3 py-1 text-xs ${plotChip === p.id ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {p.name}
          </button>
        ))}
      </div>

      {canSeeLabor && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label={MONEY.contract} value={baht(contract)} />
          <Tile label={MONEY.paid} value={baht(paid)} sub={contract > 0 ? `${pct((paid / contract) * 100)} ของสัญญา` : undefined} />
          <Tile label={MONEY.left} value={baht(Math.max(0, contract - paid))} />
          <Tile label={MONEY.dc} value={baht(dcApproved)} />
          <Tile label={MONEY.material} value={baht(materialUsed)} sub="เบิกจากสโตร์" />
        </div>
      )}
      {canSeeLabor && alerts.length > 0 && (
        <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-200" role="alert">
          จ่ายครบแล้วแต่สถานะยังไม่เสร็จ {alerts.length} งาน (ดูช่องสีแดงในแท็บงานและช่าง)
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="หมวดของกลุ่ม">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${tab === t.key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'plots' && (
        <Card className="overflow-hidden p-0">
          <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-slate-500">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[10%]">แปลง</th>
                <th className="w-[22%]">แบบบ้าน</th>
                <th className="w-[14%]">งานเสร็จ</th>
                {canSeeLabor && <th className="w-[18%] text-right">{MONEY.contract}</th>}
                {canSeeLabor && <th className="w-[18%] text-right">{MONEY.paid}</th>}
                {canSeeLabor && <th className="text-right max-md:hidden">{MONEY.left}</th>}
              </tr>
            </thead>
            <tbody>
              {scopePlots.map((p) => {
                const js = hub.jobs.filter((j) => j.plotId === p.id)
                const c = js.reduce((s, j) => s + j.value, 0)
                const pd = js.reduce((s, j) => s + j.paid, 0)
                return (
                  <tr key={p.id} onClick={() => plotModal.open(`/dashboard/projects/${projectId}/${p.id}`, `แปลง ${p.name}`)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                    <td className="font-semibold text-indigo-700">{p.name}</td>
                    <td className="truncate text-xs text-slate-600">{p.houseModel || '—'}</td>
                    <td className="tabular-nums">{js.filter((j) => j.status === 'completed').length}/{js.length}</td>
                    {canSeeLabor && <td className="text-right tabular-nums">{baht(c)}</td>}
                    {canSeeLabor && <td className="text-right tabular-nums">{baht(pd)}<div className="text-[11px] text-slate-500">{pct(c > 0 ? (pd / c) * 100 : null)}</div></td>}
                    {canSeeLabor && <td className="text-right tabular-nums max-md:hidden">{baht(Math.max(0, c - pd))}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'jobs' && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
            {(['done', 'doing', 'todo', 'alert'] as const).map((k) => (
              <span key={k}><span className={`mr-1 inline-block min-w-4 text-center ${CELL_SYMBOL[k].cls}`}>{CELL_SYMBOL[k].ch}</span>{CELL_SYMBOL[k].label}</span>
            ))}
          </div>
          <table className="w-full table-fixed text-sm">
            <thead className="bg-white">
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="w-[34%] px-3 py-2 text-left font-medium">งาน</th>
                {scopePlots.map((p) => (
                  <th key={p.id} className="px-1 py-2 text-center font-medium">
                    <Link href={`/dashboard/projects/${projectId}/${p.id}?tab=construction`} onClick={plotModal.click(`/dashboard/projects/${projectId}/${p.id}?tab=construction`, `แปลง ${p.name}`)} className="text-indigo-700 hover:underline" title={p.houseModel}>{p.name}</Link>
                  </th>
                ))}
                <th className="w-[22%] px-3 py-2 text-left font-medium max-md:hidden">ช่าง</th>
              </tr>
            </thead>
            <tbody>
              {grid.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={scopePlots.length + 2}>ยังไม่มีงาน</td></tr>}
              {grid.map(([trade, jobs]) => (
                <GridTrade key={trade} trade={trade} jobs={jobs} plots={scopePlots} projectId={projectId} linkClick={plotModal.click} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'bills' && canSeeLabor && <BillsPanel projectId={projectId} plotIds={scopeIds} kind="main" canReview={canReview} />}
      {tab === 'dc' && canSeeLabor && <BillsPanel projectId={projectId} plotIds={scopeIds} kind="dc" canReview={canReview} />}
      {tab === 'boq' && canBoq && <BoqScopeTab scope={plotChip ? { projectId, plotIds: [plotChip] } : { projectId, plotGroupId: hub.group.id }} />}

      {tab === 'cost' && canSeeLabor && (
        <Card className="overflow-hidden p-0">
          <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-slate-500">
            <thead className="bg-slate-50">
              <tr className="text-right">
                <th className="w-[12%] text-left">แปลง</th>
                <th>{MONEY.contract}</th>
                <th>{MONEY.paid}</th>
                <th>{MONEY.left}</th>
                <th>{MONEY.dc}</th>
                <th>{MONEY.material}</th>
              </tr>
            </thead>
            <tbody>
              {boardRows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">ไม่มีข้อมูลต้นทุน</td></tr>}
              {boardRows.map((r) => (
                <tr key={r.plotId} className="border-t border-slate-100 text-right tabular-nums">
                  <td className="text-left font-semibold text-indigo-700"><Link href={`/dashboard/projects/${projectId}/${r.plotId}?tab=cost`} onClick={plotModal.click(`/dashboard/projects/${projectId}/${r.plotId}?tab=cost`, `แปลง ${r.plotName}`)} className="hover:underline">{r.plotName}</Link></td>
                  <td>{baht(r.contract)}</td>
                  <td>{baht(r.paid)}</td>
                  <td>{baht(Math.max(0, (r.contract || 0) - (r.paid || 0)))}</td>
                  <td>{r.extraWorkApproved ? baht(r.extraWorkApproved) : '—'}</td>
                  <td>{r.materialUsed ? baht(r.materialUsed) : '—'}</td>
                </tr>
              ))}
              {boardRows.length > 1 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-right font-semibold tabular-nums">
                  <td className="text-left">รวม</td>
                  <td>{baht(boardRows.reduce((s, r) => s + (r.contract || 0), 0))}</td>
                  <td>{baht(boardRows.reduce((s, r) => s + (r.paid || 0), 0))}</td>
                  <td>{baht(boardRows.reduce((s, r) => s + Math.max(0, (r.contract || 0) - (r.paid || 0)), 0))}</td>
                  <td>{baht(boardRows.reduce((s, r) => s + (r.extraWorkApproved || 0), 0))}</td>
                  <td>{baht(boardRows.reduce((s, r) => s + r.materialUsed, 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    {plotModal.node}
    </PageContainer>
  )
}

function GridTrade({ trade, jobs, plots, projectId, linkClick }: { trade: string; jobs: { name: string; cells: Map<string, GroupHubJob>; crews: Set<string> }[]; plots: { id: string; name: string }[]; projectId: string; linkClick: (href: string, title: string) => (e: React.MouseEvent) => void }) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={plots.length + 2} className="px-3 py-1.5 text-xs font-semibold text-slate-700">{trade}</td>
      </tr>
      {jobs.map((j) => (
        <tr key={j.name} className="border-t border-slate-100">
          <td className="truncate px-3 py-1.5 text-slate-800" title={j.name}>{j.name}</td>
          {plots.map((p) => {
            const job = j.cells.get(p.id)
            const c = CELL_SYMBOL[cellOf(job)]
            return (
              <td key={p.id} className="px-1 py-1.5 text-center">
                <Link href={`/dashboard/projects/${projectId}/${p.id}?tab=construction`} onClick={linkClick(`/dashboard/projects/${projectId}/${p.id}?tab=construction`, `แปลง ${p.name}`)} className={`inline-block min-w-5 text-center ${c.cls}`} title={`${c.label}${job?.contractorName ? ` · ${job.contractorName}` : job ? ' · ยังไม่มีช่าง' : ''}`}>
                  {c.ch}
                </Link>
              </td>
            )
          })}
          <td className="truncate px-3 py-1.5 text-xs text-slate-600 max-md:hidden" title={[...j.crews].join(', ')}>{j.crews.size === 0 ? <span className="text-amber-700">ยังไม่มีช่าง</span> : [...j.crews].join(', ')}</td>
        </tr>
      ))}
    </>
  )
}
