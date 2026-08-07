'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { getLaborLedger, getLaborLedgerOptions } from '@/actions/labor-budget-actions'
import { formatCurrency } from '@/lib/currency'
import { UNGROUPED_BATCH_ID, type LaborLedgerEntry } from '@/lib/labor-budget'

type Option = { id: string; name: string }
type PlotGroupOption = Option & { project_id: string }

type GroupBy = 'contractor' | 'batch'

type Filters = {
  projectId?: string
  contractorId?: string
  plotGroupId?: string
}

type LedgerSection = {
  key: string
  title: string
  subtitle: string
  entries: LaborLedgerEntry[]
  budget: number
  approved: number
  pending: number
  remaining: number
  percent: number
}

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'รอเริ่ม',
  in_progress: 'กำลังทำ',
  completed: 'เสร็จสิ้น',
}

const JOB_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function LaborBudgetLedgerPage() {
  const [projects, setProjects] = useState<Option[]>([])
  const [contractors, setContractors] = useState<Option[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroupOption[]>([])

  const [filters, setFilters] = useState<Filters>({})
  const [groupBy, setGroupBy] = useState<GroupBy>('contractor')
  const [search, setSearch] = useState('')
  const [hideSettled, setHideSettled] = useState(false)

  const [entries, setEntries] = useState<LaborLedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  useEffect(() => {
    getLaborLedgerOptions()
      .then(({ projects, contractors, plotGroups }) => {
        setProjects(projects as Option[])
        setContractors(contractors as Option[])
        setPlotGroups(plotGroups as PlotGroupOption[])
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'โหลดตัวเลือกไม่สำเร็จ'))
  }, [])

  const runReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getLaborLedger(filters)
      setEntries(result.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายงานไม่สำเร็จ')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The batch dropdown only makes sense within a project — a group is scoped
  // to one. Clear a stale selection when the project changes underneath it.
  const availablePlotGroups = useMemo(() => {
    if (!filters.projectId) return plotGroups
    return plotGroups.filter((g) => String(g.project_id) === filters.projectId)
  }, [plotGroups, filters.projectId])

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (hideSettled && entry.budget > 0 && entry.remaining <= 0.005) return false
      if (!q) return true
      return (
        entry.plotName.toLowerCase().includes(q) ||
        entry.itemName.toLowerCase().includes(q) ||
        entry.contractorName.toLowerCase().includes(q) ||
        entry.groupName.toLowerCase().includes(q) ||
        entry.houseModel.toLowerCase().includes(q)
      )
    })
  }, [entries, search, hideSettled])

  const sections = useMemo<LedgerSection[]>(() => {
    const buckets = new Map<string, { title: string; entries: LaborLedgerEntry[] }>()

    const ensure = (key: string, title: string) => {
      if (!buckets.has(key)) buckets.set(key, { title, entries: [] })
      return buckets.get(key)!
    }

    for (const entry of filteredEntries) {
      if (groupBy === 'contractor') {
        ensure(entry.contractorId, entry.contractorName).entries.push(entry)
      } else {
        const key = entry.groupId || UNGROUPED_BATCH_ID
        const title = entry.groupId ? entry.groupName : 'แปลงเดี่ยว (ไม่ได้อยู่ในกลุ่ม)'
        ensure(key, title).entries.push(entry)
      }
    }

    return Array.from(buckets.entries())
      .map(([key, bucket]) => {
        const sorted = bucket.entries.slice().sort((a, b) => {
          const byPlot = collator.compare(a.plotName, b.plotName)
          if (byPlot !== 0) return byPlot
          return collator.compare(a.itemName, b.itemName)
        })
        const budget = sorted.reduce((s, e) => s + e.budget, 0)
        const approved = sorted.reduce((s, e) => s + e.approved, 0)
        const pending = sorted.reduce((s, e) => s + e.pending, 0)

        const plotCount = new Set(sorted.map((e) => e.plotId).filter(Boolean)).size
        const subtitle =
          groupBy === 'contractor'
            ? `${sorted.length} รายการงาน · ${plotCount} แปลง`
            : `${sorted.length} รายการงาน · ${plotCount} แปลง · ${new Set(sorted.map((e) => e.contractorName)).size} ผู้รับเหมา`

        return {
          key,
          title: bucket.title,
          subtitle,
          entries: sorted,
          budget,
          approved,
          pending,
          remaining: budget - approved,
          percent: budget > 0 ? (approved / budget) * 100 : 0,
        }
      })
      .sort((a, b) => collator.compare(a.title, b.title))
  }, [filteredEntries, groupBy, collator])

  const grand = useMemo(() => {
    const budget = filteredEntries.reduce((s, e) => s + e.budget, 0)
    const approved = filteredEntries.reduce((s, e) => s + e.approved, 0)
    const pending = filteredEntries.reduce((s, e) => s + e.pending, 0)
    return {
      budget,
      approved,
      pending,
      remaining: budget - approved,
      percent: budget > 0 ? (approved / budget) * 100 : 0,
    }
  }, [filteredEntries])

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="สมุดบัญชีค่าแรง (งบ / เบิกแล้ว / คงเหลือ)"
        subtitle="ยอดค่าแรงตาม BOQ เทียบกับใบเบิกที่ PM อนุมัติแล้ว แยกตามผู้รับเหมาและกลุ่มแปลง (ไม่รวมงานเพิ่ม/DC — ดูที่รายงาน DC)"
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600">โครงการ</label>
            <select
              className="mt-1 w-full"
              value={filters.projectId || ''}
              onChange={(e) =>
                setFilters((p) => ({ ...p, projectId: e.target.value || undefined, plotGroupId: undefined }))
              }
            >
              <option value="">ทั้งหมด</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ผู้รับเหมา</label>
            <select
              className="mt-1 w-full"
              value={filters.contractorId || ''}
              onChange={(e) => setFilters((p) => ({ ...p, contractorId: e.target.value || undefined }))}
            >
              <option value="">ทั้งหมด</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">กลุ่มแปลง (batch)</label>
            <select
              className="mt-1 w-full"
              value={filters.plotGroupId || ''}
              onChange={(e) => setFilters((p) => ({ ...p, plotGroupId: e.target.value || undefined }))}
            >
              <option value="">ทั้งหมด</option>
              {availablePlotGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ค้นหา (แปลง / งาน / ผู้รับเหมา)</label>
            <input
              className="mt-1 w-full"
              value={search}
              placeholder="เช่น 98 หรือ งานฐานราก"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg border bg-slate-100 p-1 w-fit">
              <button
                onClick={() => setGroupBy('contractor')}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  groupBy === 'contractor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                แยกตามผู้รับเหมา
              </button>
              <button
                onClick={() => setGroupBy('batch')}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  groupBy === 'batch' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                แยกตามกลุ่มแปลง
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={hideSettled} onChange={(e) => setHideSettled(e.target.checked)} />
              ซ่อนงานที่เบิกครบแล้ว
            </label>
          </div>
          <Button onClick={runReport} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} ค้นหา
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500">งบค่าแรงรวม (BOQ)</div>
          <div className="mt-1 text-xl font-bold text-slate-900">฿{formatCurrency(grand.budget)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">เบิกแล้ว (PM อนุมัติ)</div>
          <div className="mt-1 text-xl font-bold text-emerald-700">฿{formatCurrency(grand.approved)}</div>
          <div className="mt-1 text-[11px] text-slate-400">{grand.percent.toFixed(1)}% ของงบ</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">คงเหลือ</div>
          <div className={`mt-1 text-xl font-bold ${grand.remaining < 0 ? 'text-red-600' : 'text-indigo-700'}`}>
            ฿{formatCurrency(grand.remaining)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">รออนุมัติ</div>
          <div className="mt-1 text-xl font-bold text-amber-600">฿{formatCurrency(grand.pending)}</div>
          <div className="mt-1 text-[11px] text-slate-400">ยังไม่นับเป็นยอดเบิก</div>
        </Card>
      </div>

      {loading && (
        <Card className="flex items-center justify-center gap-2 p-10 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล...
        </Card>
      )}

      {!loading && sections.length === 0 && (
        <Card className="p-10 text-center text-slate-500">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</Card>
      )}

      {!loading &&
        sections.map((section) => {
          const isCollapsed = collapsedSections.has(section.key)
          const overBudget = section.remaining < -0.005

          // Ledger running balance: the BOQ budget for this section drawn down
          // line by line, so any row answers "what was left at this point".
          let runningRemaining = section.budget

          return (
            <Card key={section.key} className="overflow-hidden">
              <button
                onClick={() => toggleSection(section.key)}
                className="flex w-full flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                  <div>
                    <div className="font-bold text-slate-800">{section.title}</div>
                    <div className="text-xs text-slate-500">{section.subtitle}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-5 text-right text-sm">
                  <div>
                    <div className="text-[11px] text-slate-500">งบค่าแรง</div>
                    <div className="font-semibold text-slate-700">฿{formatCurrency(section.budget)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">เบิกแล้ว</div>
                    <div className="font-semibold text-emerald-700">฿{formatCurrency(section.approved)}</div>
                  </div>
                  {section.pending > 0 && (
                    <div>
                      <div className="text-[11px] text-slate-500">รออนุมัติ</div>
                      <div className="font-semibold text-amber-600">฿{formatCurrency(section.pending)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] text-slate-500">คงเหลือ</div>
                    <div className={`font-bold ${overBudget ? 'text-red-600' : 'text-indigo-700'}`}>
                      ฿{formatCurrency(section.remaining)}
                    </div>
                  </div>
                  <div className="w-28">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, section.percent))}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{section.percent.toFixed(1)}%</div>
                  </div>
                </div>
              </button>

              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-white text-slate-600">
                      <tr>
                        <th className="w-8 px-2 py-2"></th>
                        <th className="px-3 py-2 font-semibold">แปลง / รายการงาน</th>
                        <th className="px-3 py-2 font-semibold">
                          {groupBy === 'contractor' ? 'กลุ่มแปลง' : 'ผู้รับเหมา'}
                        </th>
                        <th className="px-3 py-2 font-semibold">สถานะ</th>
                        <th className="px-3 py-2 text-right font-semibold">งบค่าแรง</th>
                        <th className="px-3 py-2 text-right font-semibold">เบิกแล้ว</th>
                        <th className="px-3 py-2 text-right font-semibold">รออนุมัติ</th>
                        <th className="px-3 py-2 text-right font-semibold">คงเหลือ</th>
                        <th className="px-3 py-2 text-right font-semibold">คงเหลือสะสม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {section.entries.map((entry) => {
                        const isOpen = expandedJobs.has(entry.jobId)
                        const rowOver = entry.remaining < -0.005
                        runningRemaining -= entry.approved

                        return (
                          <Fragment key={entry.jobId}>
                            <tr
                              className="cursor-pointer align-top hover:bg-slate-50"
                              onClick={() => toggleJob(entry.jobId)}
                            >
                              <td className="px-2 py-2 text-slate-400">
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-800">
                                  {entry.plotName}
                                  {entry.houseModel && (
                                    <span className="ml-1 text-xs font-normal text-slate-400">({entry.houseModel})</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500">{entry.itemName}</div>
                                <div className="text-[11px] text-slate-400">
                                  {entry.quantity} {entry.unit} × ฿{formatCurrency(entry.pricePerUnit)}
                                  {entry.pricingSource === 'assignment' && (
                                    <span className="ml-1 rounded bg-indigo-50 px-1 text-indigo-600">ราคาตกลง</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-500">
                                {groupBy === 'contractor'
                                  ? entry.groupName || '-'
                                  : entry.contractorName}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                    JOB_STATUS_CLASSES[entry.jobStatus] || 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {JOB_STATUS_LABELS[entry.jobStatus] || entry.jobStatus}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">฿{formatCurrency(entry.budget)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                ฿{formatCurrency(entry.approved)}
                                <div className="text-[11px] font-normal text-slate-400">
                                  {entry.percent.toFixed(1)}%
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-amber-600">
                                {entry.pending > 0 ? `฿${formatCurrency(entry.pending)}` : '-'}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-bold ${rowOver ? 'text-red-600' : 'text-indigo-700'}`}
                              >
                                ฿{formatCurrency(entry.remaining)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">
                                ฿{formatCurrency(runningRemaining)}
                              </td>
                            </tr>

                            {isOpen && (
                              <tr className="bg-slate-50/70">
                                <td></td>
                                <td colSpan={8} className="px-3 py-3">
                                  {entry.transactions.length === 0 ? (
                                    <div className="text-xs text-slate-400">ยังไม่มีการเบิกสำหรับงานนี้</div>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead className="border-b text-slate-500">
                                        <tr>
                                          <th className="px-2 py-1 text-left font-semibold">เลขที่ใบเบิก</th>
                                          <th className="px-2 py-1 text-left font-semibold">วันที่</th>
                                          <th className="px-2 py-1 text-right font-semibold">% สะสม</th>
                                          <th className="px-2 py-1 text-right font-semibold">จำนวนเงิน</th>
                                          <th className="px-2 py-1 text-right font-semibold">คงเหลือหลังเบิก</th>
                                          <th className="px-2 py-1 text-left font-semibold">การจ่าย</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200">
                                        {(() => {
                                          let balance = entry.budget
                                          return entry.transactions.map((tx) => {
                                            balance -= tx.amount
                                            return (
                                              <tr key={tx.id}>
                                                <td className="px-2 py-1 font-medium text-slate-700">
                                                  {tx.docNo ? `#${tx.docNo}` : 'ไม่ระบุใบเบิก'}
                                                </td>
                                                <td className="px-2 py-1 text-slate-500">{formatDate(tx.date)}</td>
                                                <td className="px-2 py-1 text-right text-slate-500">
                                                  {tx.progressPercent == null ? '-' : `${tx.progressPercent.toFixed(2)}%`}
                                                </td>
                                                <td className="px-2 py-1 text-right font-semibold text-emerald-700">
                                                  ฿{formatCurrency(tx.amount)}
                                                </td>
                                                <td className="px-2 py-1 text-right text-slate-500">
                                                  ฿{formatCurrency(balance)}
                                                </td>
                                                <td className="px-2 py-1">
                                                  {tx.paidOutAt ? (
                                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                                                      จ่ายแล้ว {formatDate(tx.paidOutAt)}
                                                    </span>
                                                  ) : (
                                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                                                      รอจ่าย
                                                    </span>
                                                  )}
                                                </td>
                                              </tr>
                                            )
                                          })
                                        })()}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 bg-slate-50 font-bold text-slate-800">
                      <tr>
                        <td></td>
                        <td className="px-3 py-2" colSpan={3}>รวม {section.title}</td>
                        <td className="px-3 py-2 text-right">฿{formatCurrency(section.budget)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">฿{formatCurrency(section.approved)}</td>
                        <td className="px-3 py-2 text-right text-amber-600">
                          {section.pending > 0 ? `฿${formatCurrency(section.pending)}` : '-'}
                        </td>
                        <td className={`px-3 py-2 text-right ${overBudget ? 'text-red-600' : 'text-indigo-700'}`}>
                          ฿{formatCurrency(section.remaining)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">฿{formatCurrency(section.remaining)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )
        })}
    </div>
  )
}
