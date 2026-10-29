import { getBillingOptions } from '@/actions/billing-actions'
import { getContractorBalances } from '@/actions/billing/balances'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import { formatThaiDay } from '@/lib/weekly-plan'
import { getDashboardSession } from '@/lib/auth/route-access'
import { ButtonLink } from '@/components/ui/Button'

type Search = { project?: string }

/**
 * Money left per contractor: contract value, paid, awaiting review, work done
 * according to the site record (weekly plan), and what is still owed or claimable.
 * Jobs with no recorded progress are counted as "unknown", never as zero.
 */
export default async function ContractorBalancesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { project } = await searchParams
  const { projects } = await getBillingOptions()
  const projectId = project || projects[0]?.id || ''
  const contractors = projectId ? await getContractorBalances(projectId) : []
  // "เบิกงวด" opens the bill form on this project and contractor.
  const { role } = await getDashboardSession()
  const canRequest = role === 'pm' || role === 'admin'

  return (
    <div className="space-y-5">
      <PageHeader title="ยอดคงเหลือผู้รับเหมา" subtitle="มูลค่างาน เบิกแล้ว และความคืบหน้าจริงหน้างาน (จากแผนงานประจำสัปดาห์)" />

      <form method="get" className="flex items-center gap-2">
        <select name="project" defaultValue={projectId} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="โครงการ">
          {projects.map((p: { id: string; name: string }) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ดูข้อมูล
        </button>
      </form>

      {contractors.length === 0 ? (
        <Card className="p-6 text-sm text-slate-500">ไม่มีงานที่มอบหมายให้ผู้รับเหมาในโครงการนี้</Card>
      ) : (
        contractors.map((c) => {
          const value = c.jobs.reduce((s, j) => s + j.value, 0)
          const paid = c.jobs.reduce((s, j) => s + j.paid, 0)
          const pending = c.jobs.reduce((s, j) => s + j.pending, 0)
          const known = c.jobs.filter((j) => j.recorded)
          const earnedKnown = known.reduce((s, j) => s + (j.value * (j.recorded as { pct: number }).pct) / 100, 0)
          const claimableKnown = known.reduce((s, j) => s + Math.max(0, (j.value * (j.recorded as { pct: number }).pct) / 100 - j.paid - j.pending), 0)
          return (
            <Card key={c.contractorId} className="p-0">
              <div className="border-b border-slate-100 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{c.contractorName}</h3>
                  {canRequest && (
                    <ButtonLink
                      href={`/dashboard/billing/request?projectId=${encodeURIComponent(projectId)}&contractorId=${encodeURIComponent(c.contractorId)}`}
                      variant="secondary"
                      size="sm"
                    >
                      เบิกงวด
                    </ButtonLink>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['มูลค่างานทั้งหมด', value],
                    ['เบิกแล้ว', paid],
                    ['รอ PM ตรวจ', pending],
                    ['คงเหลือที่ต้องจ่าย', Math.max(0, value - paid - pending)],
                    [`งานเสร็จตามบันทึก (${known.length}/${c.jobs.length} งาน)`, earnedKnown],
                    ['เบิกเพิ่มได้ตามงานจริง', claimableKnown],
                  ].map(([label, v]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">฿{formatCurrency(v as number)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="px-5 py-2 text-left font-medium">งาน</th>
                      <th className="px-3 py-2 text-right font-medium">มูลค่า</th>
                      <th className="px-3 py-2 text-right font-medium">เบิกแล้ว</th>
                      <th className="px-3 py-2 text-right font-medium">เบิกแล้ว %</th>
                      <th className="px-3 py-2 text-right font-medium">งานจริงหน้างาน</th>
                      <th className="px-3 py-2 text-right font-medium">เบิกเพิ่มได้</th>
                      <th className="px-5 py-2 text-right font-medium">คงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.jobs.map((j) => {
                      const paidPct = (j.paid / j.value) * 100
                      const claimable = j.recorded ? Math.max(0, (j.value * j.recorded.pct) / 100 - j.paid - j.pending) : null
                      const ahead = j.recorded != null && paidPct > j.recorded.pct + 5
                      return (
                        <tr key={j.jobId} className="border-t border-slate-100">
                          <td className="px-5 py-2">
                            {j.title} <span className="text-xs text-slate-500">แปลง {j.plotName}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(j.value)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(j.paid)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${ahead ? 'font-medium text-red-700' : ''}`}>{paidPct.toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {j.recorded ? (
                              <>
                                {j.recorded.pct}% <span className="text-[11px] text-slate-500">({formatThaiDay(j.recorded.asOf)})</span>
                              </>
                            ) : (
                              <span className="text-slate-400">ไม่มีบันทึก</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{claimable == null ? '-' : formatCurrency(claimable)}</td>
                          <td className="px-5 py-2 text-right font-medium tabular-nums">{formatCurrency(Math.max(0, j.value - j.paid - j.pending))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        })
      )}
      <p className="text-xs text-slate-500">
        “คงเหลือ” = มูลค่า − เบิกแล้ว − รอ PM ตรวจ · “เบิกเพิ่มได้” = มูลค่า × ความคืบหน้าจริง − เบิกแล้ว − รอตรวจ (เฉพาะงานที่มีบันทึก)
      </p>
    </div>
  )
}
