'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// "ซื้อเพื่ออะไร" - the first question on a PR / PO (MATERIAL_TRAIL_PLAN.md
// Phase B). The answer is not stored anywhere of its own: it is the kind of the
// project the document is saved against (202610160002_store_purchase_kind.sql).

export type ProjectKind = 'development' | 'overhead' | 'store'
export type PurchasePurpose = 'project' | 'store' | 'overhead'

const KIND_FOR_PURPOSE: Record<PurchasePurpose, ProjectKind> = {
  project: 'development',
  store: 'store',
  overhead: 'overhead',
}

const PURPOSE_FOR_KIND: Record<ProjectKind, PurchasePurpose> = {
  development: 'project',
  store: 'store',
  overhead: 'overhead',
}

const OPTIONS: { value: PurchasePurpose; label: string; hint: string }[] = [
  { value: 'project', label: 'ใช้กับโครงการ / แปลง', hint: 'ของสำหรับโครงการหรือแปลงที่ระบุ ตรวจกับ BOQ ของแปลง' },
  { value: 'store', label: 'เติมสต็อกสโตร์', hint: 'ของเข้าสโตร์กลาง ไม่ต้องเลือกโครงการหรือแปลง ต้นทุนจะเข้าแปลงตอนเบิกใช้' },
  { value: 'overhead', label: 'ค่าใช้จ่ายส่วนกลาง', hint: 'สำนักงาน อุปกรณ์ช่าง แพลนท์ปูน ฯลฯ ไม่ผูกกับแปลง' },
]

type ProjectWithKind = { id: string; kind?: string | null }

function kindOf(project: ProjectWithKind | undefined): ProjectKind {
  const k = project?.kind
  return k === 'store' || k === 'overhead' ? k : 'development'
}

/** Purpose of a form, derived from its chosen project when there is one (so an
 * edited PO or a PO made from a PR opens on the right purpose), otherwise the
 * last choice the user made. Choosing "store" fills in the store project. */
export function usePurchasePurpose<P extends ProjectWithKind>(
  projects: P[],
  projectId: string,
  onProjectChange: (projectId: string) => void,
  initialPurpose: PurchasePurpose = 'project'
) {
  const [chosen, setChosen] = useState<PurchasePurpose>(initialPurpose)
  const selected = projectId ? projects.find((p) => p.id === projectId) : undefined
  const purpose: PurchasePurpose = selected ? PURPOSE_FOR_KIND[kindOf(selected)] : chosen
  const storeProject = projects.find((p) => kindOf(p) === 'store')

  function setPurpose(next: PurchasePurpose) {
    setChosen(next)
    if (next === 'store') {
      onProjectChange(storeProject?.id || '')
    } else if (selected && PURPOSE_FOR_KIND[kindOf(selected)] !== next) {
      onProjectChange('')
    }
  }

  const projectsForPurpose = projects.filter((p) => kindOf(p) === KIND_FOR_PURPOSE[purpose])

  return { purpose, setPurpose, projectsForPurpose, storeProject }
}

export default function PurchasePurposePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PurchasePurpose
  onChange: (purpose: PurchasePurpose) => void
  disabled?: boolean
}) {
  const hint = OPTIONS.find((o) => o.value === value)?.hint

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">ซื้อเพื่ออะไร</label>
      <div role="radiogroup" aria-label="ซื้อเพื่ออะไร" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-60',
              value === o.value
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
