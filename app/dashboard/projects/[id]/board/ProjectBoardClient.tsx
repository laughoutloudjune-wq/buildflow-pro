'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'
import NoticeBanner from '@/components/ui/NoticeBanner'
import { useUrlState } from '@/lib/use-url-state'
import { useDepartment } from '@/components/layout/DepartmentContext'
import type { CostBoardRow } from '@/actions/procurement/cost-board'
import type { getCostBoard } from '@/actions/procurement/cost-board'
import type { BoardExtras, BoardPlotExtras } from '@/actions/construction-hubs'
import { getMaterialsSummaryForProject } from '@/actions/procurement-actions'
import type { MaterialsSummaryRow } from '@/actions/procurement/materials-summary'
import BoqScopeTab from '@/components/construction/BoqScopeTab'
import BillsPanel from '@/components/construction/BillsPanel'
import MaterialCostTab from '@/components/cost-control/MaterialCostTab'
import { MONEY, StatusPill, Tile, baht, pct, type HubStatus } from '@/components/construction/vocab'

type Board = Awaited<ReturnType<typeof getCostBoard>>
type Tab = 'plots' | 'boq' | 'bills' | 'dc' | 'matcost'
type SortKey = 'plot' | 'attention' | 'paid'

const EMPTY_EXTRAS: BoardPlotExtras = { pendingBills: 0, pendingAmount: 0, noCrewJobs: 0, paidNotDone: [] }
const byName = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true })

type FlagKind = 'overpaid' | 'paidNotDone' | 'behind' | 'bills' | 'noCrew' | 'material'
type Flag = { text: string; level: 0 | 1; tab?: string; kind: FlagKind; n?: number }

/** Why a plot needs a look. Level 0 = เกิน (red), level 1 = ต้องดู (amber). */
function plotFlags(r: CostBoardRow, x: BoardPlotExtras, batchOver: number): Flag[] {
  const flags: Flag[] = []
  if ((r.paidAhead || 0) > 0) flags.push({ kind: 'overpaid', level: 0, tab: 'construction', n: r.paidAheadJobs || 1, text: `จ่ายเกินงานที่ทำได้ ${baht(r.paidAhead)} ใน ${r.paidAheadJobs} งาน` })
  if (x.paidNotDone.length > 0) flags.push({ kind: 'paidNotDone', level: 1, tab: 'construction', n: x.paidNotDone.length, text: `${x.paidNotDone.length} งานจ่ายครบแต่ยังไม่เสร็จ` })
  if (r.health === 'behind' && r.expectedPercent != null && r.actualPercent != null) flags.push({ kind: 'behind', level: 1, tab: 'construction', text: `ช้ากว่าแผน ${Math.round(r.expectedPercent - r.actualPercent)}%` })
  if (x.pendingBills > 0) flags.push({ kind: 'bills', level: 1, tab: 'bills', n: x.pendingBills, text: `ใบเบิกรอตรวจ ${x.pendingBills} ใบ (${baht(x.pendingAmount)})` })
  if (x.noCrewJobs > 0 && r.jobCount > 0) flags.push({ kind: 'noCrew', level: 1, tab: 'construction', n: x.noCrewJobs, text: `${x.noCrewJobs} งานยังไม่มีช่าง` })
  if (batchOver > 0) flags.push({ kind: 'material', level: 1, tab: 'materials', n: batchOver, text: `วัสดุเกิน BOQ ${batchOver} รายการ (ทั้งกลุ่ม)` })
  return flags
}

function statusOf(flags: Flag[]): HubStatus {
  if (flags.some((f) => f.level === 0)) return 'over'
  return flags.length > 0 ? 'watch' : 'ok'
}

export default function ProjectBoardClient({
  projectId,
  projects,
  board,
  extras,
  batchMaterial,
  canSeeLabor,
  canBilling,
  error,
}: {
  projectId: string
  projects: { id: string; name: string }[]
  board: Board | null
  extras: BoardExtras | null
  batchMaterial: Record<string, { over: number; watch: number; overValue: number }>
  canSeeLabor: boolean
  canBilling: boolean
  error: string | null
}) {
  const router = useRouter()
  const { theme } = useDepartment()
  const [tab, setTab] = useUrlState<Tab>('tab', 'plots', ['plots', 'boq', 'bills', 'dc', 'matcost'] as const)
  const [sort, setSort] = useUrlState<SortKey>('sort', 'plot', ['plot', 'attention', 'paid'] as const)
  const [search, setSearch] = useUrlState<string>('q', '')

  // Remember this project so the menu entry opens it next time.
  useEffect(() => {
    document.cookie = `buildflow.board-project=${projectId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }, [projectId])

  const rows = useMemo(() => board?.rows || [], [board])
  const totals = board?.totals
  const xOf = (plotId: string) => extras?.byPlot[plotId] || EMPTY_EXTRAS

  const model = useMemo(() => {
    return rows.map((r) => {
      const flags = canSeeLabor ? plotFlags(r, xOf(r.plotId), r.groupId ? batchMaterial[r.groupId]?.over || 0 : 0) : []
      return { r, flags, status: statusOf(flags) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, extras, batchMaterial, canSeeLabor])

  const attention = useMemo(
    () =>
      model
        .flatMap((m) => m.flags.map((f) => ({ plot: m.r, ...f })))
        .sort((a, b) => a.level - b.level || byName(a.plot.plotName, b.plot.plotName)),
    [model]
  )

  const KIND_LABEL: Record<FlagKind, { label: string; unit: string }> = {
    overpaid: { label: 'จ่ายเกินงานที่ทำได้', unit: 'งาน' },
    paidNotDone: { label: 'จ่ายครบแต่สถานะยังไม่เสร็จ', unit: 'งาน' },
    bills: { label: 'ใบเบิกรอตรวจ', unit: 'ใบ' },
    noCrew: { label: 'งานยังไม่มีช่าง', unit: 'งาน' },
    behind: { label: 'ช้ากว่าแผน', unit: '' },
    material: { label: 'วัสดุเกิน BOQ (ทั้งกลุ่ม)', unit: 'รายการ' },
  }
  const summary = useMemo(() => {
    const map = new Map<FlagKind, { kind: FlagKind; level: 0 | 1; tab?: string; plots: CostBoardRow[]; total: number }>()
    for (const a of attention) {
      const g = map.get(a.kind) || { kind: a.kind, level: a.level, tab: a.tab, plots: [] as CostBoardRow[], total: 0 }
      g.plots.push(a.plot)
      g.total += a.n || 0
      map.set(a.kind, g)
    }
    return [...map.values()].sort((a, b) => a.level - b.level || b.plots.length - a.plots.length)
  }, [attention])
  const [openKinds, setOpenKinds] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; items: typeof model }>()
    for (const m of model) {
      const key = m.r.groupId || ''
      const g = map.get(key) || { id: key, name: m.r.groupName, items: [] as typeof model }
      g.items.push(m)
      map.set(key, g)
    }
    const rank = { over: 0, watch: 1, ok: 2 } as const
    const sortItems = (items: typeof model) =>
      [...items].sort((a, b) => {
        if (sort === 'attention') return rank[a.status] - rank[b.status] || byName(a.r.plotName, b.r.plotName)
        if (sort === 'paid') return (b.r.paidPercent ?? -1) - (a.r.paidPercent ?? -1) || byName(a.r.plotName, b.r.plotName)
        return byName(a.r.plotName, b.r.plotName)
      })
    return [...map.values()]
      .map((g) => ({ ...g, items: sortItems(g.items) }))
      .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : byName(a.items[0].r.plotName, b.items[0].r.plotName)))
  }, [model, sort])

  // ---- search: plot number, batch name or contractor name ------------------
  const q = search.trim().toLowerCase()
  const hits = useMemo(() => {
    if (!q) return []
    const out: { key: string; label: string; sub: string; href: string }[] = []
    for (const r of rows) {
      if (r.plotName.toLowerCase().includes(q)) out.push({ key: `p-${r.plotId}`, label: `แปลง ${r.plotName}`, sub: [r.houseModel, r.groupName].filter(Boolean).join(' · '), href: `/dashboard/projects/${projectId}/${r.plotId}` })
    }
    const seenGroups = new Set<string>()
    for (const r of rows) {
      if (r.groupId && !seenGroups.has(r.groupId) && r.groupName.toLowerCase().includes(q)) {
        seenGroups.add(r.groupId)
        out.push({ key: `g-${r.groupId}`, label: `กลุ่ม ${r.groupName}`, sub: 'ดูทั้งกลุ่ม', href: `/dashboard/projects/${projectId}/groups/${r.groupId}` })
      }
    }
    for (const c of extras?.contractors || []) {
      if (c.name.toLowerCase().includes(q)) out.push({ key: `c-${c.id}`, label: `ช่าง ${c.name}`, sub: `${c.plotIds.length} แปลงในโครงการนี้`, href: `/dashboard/contractors/${c.id}` })
    }
    return out.slice(0, 8)
  }, [q, rows, extras, projectId])

  // The materials-cost tab (what the old ต้นทุนวัสดุ tab showed) loads on demand.
  const [matCost, setMatCost] = useState<{ projectId: string; rows: MaterialsSummaryRow[] } | null>(null)
  useEffect(() => {
    if (tab !== 'matcost' || matCost?.projectId === projectId) return
    let cancelled = false
    getMaterialsSummaryForProject(projectId, {}).then((r) => !cancelled && setMatCost({ projectId, rows: r })).catch(() => !cancelled && setMatCost({ projectId, rows: [] }))
    return () => {
      cancelled = true
    }
  }, [tab, projectId, matCost])

  const contract = totals?.contract ?? null
  const paid = totals?.paid ?? null
  const left = contract != null && paid != null ? Math.max(0, contract - paid) : null
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'plots', label: 'ภาพรวมแปลง', show: true },
    { key: 'boq', label: 'วัสดุ BOQ', show: true },
    { key: 'bills', label: 'ใบเบิก', show: canSeeLabor },
    { key: 'dc', label: 'งานเพิ่ม (DC)', show: canSeeLabor },
    { key: 'matcost', label: 'ต้นทุนวัสดุ', show: true },
  ]

  return (
    <PageContainer width="wide">
      <BackButton fallbackHref="/dashboard/projects" label="โครงการทั้งหมด" />
      <PageHeader
        title="ภาพรวมโครงการ"
        subtitle="แปลงทุกหลังในหน้าเดียว กดแปลงหรือกลุ่มเพื่อดูงาน ใบเบิก วัสดุ และต้นทุนของมัน"
        actions={
          <>
            <select aria-label="โครงการ" value={projectId} onChange={(e) => router.push(`/dashboard/projects/${e.target.value}/board`)} className="min-w-[12rem]">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ButtonLink href={`/dashboard/projects/${projectId}`} variant="secondary" size="sm">
              ผังโครงการ &amp; จัดกลุ่มแปลง
            </ButtonLink>
          </>
        }
      />

      {error && <NoticeBanner tone="error" message={error} />}

      {canSeeLabor && totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label={MONEY.contract} value={baht(contract)} />
          <Tile label={MONEY.paid} value={baht(paid)} sub={contract ? `${pct(((paid || 0) / contract) * 100)} ของสัญญา` : undefined} />
          <Tile label={MONEY.left} value={baht(left)} />
          <Tile label={MONEY.dc} value={baht(totals.extraWorkApproved)} sub={totals.extraWorkPending ? `รออนุมัติ ${baht(totals.extraWorkPending)}` : undefined} />
          <Tile
            label="ใบเบิก รอตรวจ · รอจ่าย"
            value={`${extras?.pendingCount ?? 0} · ${totals.toPayOutCount}`}
            sub={`รอจ่าย ${baht(totals.toPayOut)}`}
            href={canBilling ? `/dashboard/billing?projectId=${projectId}&tab=${(extras?.pendingCount ?? 0) > 0 ? 'review' : 'pay'}` : undefined}
            tone={(extras?.pendingCount ?? 0) > 0 ? 'amber' : 'default'}
          />
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="หมวดของโครงการ">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`border-b-2 px-3 py-2.5 text-sm font-medium transition ${tab === t.key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'boq' && <BoqScopeTab scope={{ projectId }} />}
      {tab === 'bills' && canSeeLabor && <BillsPanel projectId={projectId} kind="main" canReview={canBilling} />}
      {tab === 'dc' && canSeeLabor && <BillsPanel projectId={projectId} kind="dc" canReview={canBilling} />}
      {tab === 'matcost' &&
        (matCost?.projectId === projectId ? (
          <div className="space-y-2">
            <MaterialCostTab rows={matCost.rows} />
            {canSeeLabor && (
              <p className="text-xs text-slate-500">
                ค่าแรงรายเดือนและงบแรงงาน: <Link href="/dashboard/reports/labor-budget" className="text-indigo-600 hover:underline">สมุดบัญชีค่าแรง ›</Link>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">กำลังโหลด...</p>
        ))}

      {tab === 'plots' && (
        <>
          <div className="relative">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเลขแปลง ชื่อกลุ่ม หรือชื่อช่าง เช่น 103, 103-107, สำราญ" className="w-full pl-9" aria-label="ค้นหา" />
            </label>
            {q && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                {hits.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-500">ไม่พบ &ldquo;{search}&rdquo;</p>
                ) : (
                  hits.map((h) => (
                    <Link key={h.key} href={h.href} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-indigo-50">
                      <span className="font-medium text-slate-800">{h.label}</span>
                      <span className="truncate text-xs text-slate-500">{h.sub}</span>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>

          {canSeeLabor && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">ต้องดู {summary.length > 0 ? `(${attention.length} แปลง-เรื่อง)` : ''}</h3>
              {summary.length === 0 ? (
                <p className="text-sm text-emerald-700">ไม่มีแปลงที่ต้องดู</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.map((g) => {
                    const open = !!openKinds[g.kind] || (g.level === 0 && g.plots.length <= 5)
                    const info = KIND_LABEL[g.kind]
                    const shown = open ? g.plots : g.plots.slice(0, 0)
                    return (
                      <li key={g.kind} className="py-2 text-sm">
                        <button type="button" onClick={() => setOpenKinds((o) => ({ ...o, [g.kind]: !o[g.kind] }))} className="flex w-full items-center gap-2 text-left">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${g.level === 0 ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
                          <span className="font-medium text-slate-800">{info.label}</span>
                          <span className="text-slate-600">{g.plots.length} แปลง{g.total > 0 && info.unit ? ` · ${g.total} ${info.unit}` : ''}</span>
                          <span className="ml-auto text-xs text-indigo-600">{open ? 'ซ่อน' : 'ดูแปลง'}</span>
                        </button>
                        {open && (
                          <div className="mt-2 flex flex-wrap gap-1.5 pl-4">
                            {shown.map((p) => (
                              <Link key={p.plotId} href={`/dashboard/projects/${projectId}/${p.plotId}${g.tab ? `?tab=${g.tab}` : ''}`} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50">
                                {p.plotName}
                              </Link>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">เรียงตาม</span>
            {([['plot', 'เลขแปลง'], ['attention', 'ต้องดูก่อน'], ['paid', 'จ่ายแล้ว %']] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)} className={`rounded-full border px-3 py-1 ${sort === key ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>

          {groups.length === 0 && <Card className="p-6 text-center text-sm text-slate-500">ยังไม่มีแปลงในโครงการนี้</Card>}
          {groups.map((g) => {
            const bm = g.id ? batchMaterial[g.id] : undefined
            return (
              <Card key={g.id || '~none'} className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                  {g.id ? (
                    <Link href={`/dashboard/projects/${projectId}/groups/${g.id}`} className="text-sm font-semibold text-indigo-700 hover:underline">
                      {g.name || 'กลุ่ม'} ›
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-slate-800">ไม่อยู่ในกลุ่ม</span>
                  )}
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {g.items.length} แปลง
                    {bm && bm.over > 0 && <StatusPill status="over" label={`${MONEY.material}: เกิน ${bm.over} รายการ`} />}
                    {bm && bm.over === 0 && bm.watch > 0 && <StatusPill status="watch" label={`${MONEY.material}: ต้องดู ${bm.watch}`} />}
                  </span>
                </div>
                <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-slate-500">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="w-[9%]">แปลง</th>
                      <th className="w-[14%] max-sm:hidden">แบบบ้าน</th>
                      <th className="w-[19%]">งานเสร็จ</th>
                      {canSeeLabor && <th className="w-[12%] text-right max-md:hidden">{MONEY.contract}</th>}
                      {canSeeLabor && <th className="w-[12%] text-right">{MONEY.paid}</th>}
                      {canSeeLabor && <th className="w-[9%] text-right max-lg:hidden">DC</th>}
                      <th className="w-[10%] text-right max-lg:hidden">{MONEY.material}</th>
                      <th className="w-[9%]">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(({ r, status, flags }) => {
                      const done = r.actualPercent == null ? null : Math.min(100, r.actualPercent)
                      const paidTick = r.paidPercent == null ? null : Math.min(100, r.paidPercent)
                      return (
                        <tr key={r.plotId} onClick={() => router.push(`/dashboard/projects/${projectId}/${r.plotId}`)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" title={flags.map((f) => f.text).join(' · ') || undefined}>
                          <td className="font-semibold text-indigo-700">{r.plotName}</td>
                          <td className="truncate text-xs text-slate-600 max-sm:hidden">{r.houseModel || '—'}</td>
                          <td>
                            <div className="relative h-2 rounded-full bg-slate-100" aria-hidden>
                              {done != null && <span className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${done}%` }} />}
                              {paidTick != null && <span className="absolute -inset-y-0.5 w-0.5 bg-slate-800" style={{ left: `${paidTick}%` }} />}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {r.jobsDone}/{r.jobCount} งาน{done != null ? ` · ${pct(r.actualPercent)}` : ''}
                            </div>
                          </td>
                          {canSeeLabor && <td className="text-right tabular-nums max-md:hidden">{baht(r.contract)}</td>}
                          {canSeeLabor && (
                            <td className="text-right tabular-nums">
                              {baht(r.paid)}
                              <div className="text-[11px] text-slate-500">{pct(r.paidPercent)}</div>
                            </td>
                          )}
                          {canSeeLabor && <td className="text-right tabular-nums max-lg:hidden">{r.extraWorkApproved ? baht(r.extraWorkApproved) : '—'}</td>}
                          <td className="text-right tabular-nums max-lg:hidden">{r.materialUsed ? baht(r.materialUsed) : '—'}</td>
                          <td>{canSeeLabor ? <StatusPill status={status} /> : <span className="text-xs text-slate-400">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )
          })}
          <p className="text-xs text-slate-500">
            แถบ = งานที่ทำได้ตามมูลค่า · เส้นดำ = จ่ายแล้วกี่ % · {MONEY.material} = เบิกจากสโตร์ (เบิกของกลุ่มแบ่งเท่ากันทุกแปลง) · สถานะ ต้องดู/เกิน เป็นคำเตือน ไม่ได้ปิดกั้นการทำงาน · วัสดุ BOQ เทียบรายกลุ่ม ดูรายแปลงได้ในหน้าแปลง
          </p>
        </>
      )}
    </PageContainer>
  )
}
