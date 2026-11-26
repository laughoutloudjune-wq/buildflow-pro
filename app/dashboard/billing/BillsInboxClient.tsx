'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Link from 'next/link'
import { Plus, Printer } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { useUrlObject, useUrlState } from '@/lib/use-url-state'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { useHubModal } from '@/components/construction/useHubModal'
import BillsPanel from '@/components/construction/BillsPanel'
import ContractorCycleReport from '@/components/billings/ContractorCycleReport'

type Tab = 'review' | 'pay' | 'paid' | 'returned' | 'all'
type Kind = 'all' | 'main' | 'dc'
type Filters = { projectId?: string; contractorId?: string; month?: string }

const TABS: { key: Tab; label: string }[] = [
  { key: 'review', label: 'รอตรวจ' },
  { key: 'pay', label: 'รอจ่าย' },
  { key: 'paid', label: 'จ่ายแล้ว' },
  { key: 'returned', label: 'ส่งกลับ' },
  { key: 'all', label: 'ทั้งหมด' },
]

/**
 * Bills inbox. รอตรวจ / ส่งกลับ / ทั้งหมด are bill lists (created time + sorting);
 * รอจ่าย / จ่ายแล้ว are the contractor payout cycle (grouped by contractor,
 * tick bills, บันทึกจ่าย, printable summary for accounting). Every bill that
 * waits for review opens in a wide popup and returns here when closed.
 */
export default function BillsInboxClient(props: { projects: { id: string; name: string }[]; contractors: { id: string; name: string }[]; canCreate: boolean }) {
  return (
    <Suspense>
      <Inbox {...props} />
    </Suspense>
  )
}

function Inbox({ projects, contractors, canCreate }: { projects: { id: string; name: string }[]; contractors: { id: string; name: string }[]; canCreate: boolean }) {
  const { theme } = useDepartment()
  const [tab, setTab] = useUrlState<Tab>('tab', 'review', ['review', 'pay', 'paid', 'returned', 'all'] as const)
  const [kind, setKind] = useUrlState<Kind>('kind', 'all', ['all', 'main', 'dc'] as const)
  const [filters, setFilters] = useUrlObject<Filters>(['projectId', 'contractorId', 'month'])
  const cycle = tab === 'pay' || tab === 'paid'
  // The review page sends its outcome back as ?message=...&type=...
  const router = useRouter()
  const searchParams = useSearchParams()
  const [dismissed, setDismissed] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const formModal = useHubModal(() => setRefreshKey((n) => n + 1))
  const message = searchParams.get('message')
  const type = searchParams.get('type')
  const flashTone = type === 'error' || type === 'warning' || type === 'info' ? type : 'success'

  const printParams = new URLSearchParams()
  if (filters.projectId) printParams.set('projectId', filters.projectId)
  if (filters.contractorId) printParams.set('contractorId', filters.contractorId)
  if (filters.month) printParams.set('month', filters.month)
  if (tab === 'review') printParams.set('status', 'pending_review')
  if (tab === 'returned') printParams.set('status', 'rejected')

  return (
    <PageContainer width="wide">
      <PageHeader
        title="ใบเบิกช่าง"
        subtitle="ตรวจใบเบิก บันทึกจ่าย และดูประวัติ ในที่เดียว: รอตรวจ → รอจ่าย → จ่ายแล้ว"
        actions={
          <>
            {!cycle && (
              <ButtonLink href={`/dashboard/billing/print${printParams.toString() ? `?${printParams}` : ''}`} target="_blank" rel="noopener" variant="secondary">
                <Printer className="h-4 w-4" /> พิมพ์รายการ
              </ButtonLink>
            )}
            {canCreate && (
              <>
                <Button variant="secondary" onClick={() => formModal.open('/dashboard/foreman/create-progress', 'เบิกงวดงานหลัก', true)}>
                  <Plus className="h-4 w-4" /> เบิกงวด
                </Button>
                <Button onClick={() => formModal.open('/dashboard/foreman/create-dc', 'งานเพิ่ม (DC)', true)}>
                  <Plus className="h-4 w-4" /> งานเพิ่ม (DC)
                </Button>
              </>
            )}
          </>
        }
      />

      {message && !dismissed && (
        <NoticeBanner
          tone={flashTone}
          message={message}
          onClose={() => {
            setDismissed(true)
            const rest = new URLSearchParams(window.location.search)
            rest.delete('type')
            rest.delete('message')
            const qs = rest.toString()
            router.replace(qs ? `/dashboard/billing?${qs}` : '/dashboard/billing')
          }}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1" role="tablist" aria-label="สถานะใบเบิก">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t.key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center gap-1.5" role="group" aria-label="ประเภทใบเบิก">
          {([['all', 'ทั้งหมด'], ['main', 'งานหลัก'], ['dc', 'งานเพิ่ม (DC)']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {cycle ? (
        <ContractorCycleReport key={tab} embeddedTab={tab === 'pay' ? 'unpaid' : 'paid'} kind={kind} />
      ) : (
        <>
          <PageToolbar
            activeFilters={[
              ...(filters.month ? [{ label: `เดือน ${filters.month}`, onRemove: () => setFilters((p) => ({ ...p, month: undefined })) }] : []),
              ...(filters.projectId ? [{ label: projects.find((x) => x.id === filters.projectId)?.name ?? 'โครงการ', onRemove: () => setFilters((p) => ({ ...p, projectId: undefined })) }] : []),
              ...(filters.contractorId ? [{ label: contractors.find((x) => x.id === filters.contractorId)?.name ?? 'ผู้รับเหมา', onRemove: () => setFilters((p) => ({ ...p, contractorId: undefined })) }] : []),
            ]}
            onReset={() => setFilters({})}
          >
            <input type="month" aria-label="เดือนของบิล" value={filters.month || ''} onChange={(e) => setFilters((p) => ({ ...p, month: e.target.value || undefined }))} />
            <select aria-label="โครงการ" className="min-w-[10rem]" value={filters.projectId || ''} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value || undefined }))}>
              <option value="">ทุกโครงการ</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select aria-label="ผู้รับเหมา" className="min-w-[10rem]" value={filters.contractorId || ''} onChange={(e) => setFilters((p) => ({ ...p, contractorId: e.target.value || undefined }))}>
              <option value="">ทุกผู้รับเหมา</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </PageToolbar>

          <BillsPanel
            key={`${tab}-${kind}`}
            refreshKey={refreshKey}
            projectId={filters.projectId}
            contractorId={filters.contractorId}
            month={filters.month}
            kind={kind}
            canReview
            fixedStage={tab === 'review' ? 'review' : tab === 'returned' ? 'returned' : undefined}
            initialSort={tab === 'review' ? { key: 'created', dir: 1 } : undefined}
          />
          <p className="text-xs text-slate-500">
            กดที่แถวเพื่อเปิดใบเบิก · ผู้รับเหมาแต่ละรายดูภาพรวมได้ที่ <Link href="/dashboard/contractors" className="text-indigo-600 hover:underline">หน้าผู้รับเหมา</Link>
          </p>
        </>
      )}
    {formModal.node}
    </PageContainer>
  )
}
