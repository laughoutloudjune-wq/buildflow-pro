'use client'

import SearchableSelect from '@/components/ui/SearchableSelect'
import type { ControlScope } from '@/lib/procurement/boqControl'

export type ScopeMode = 'project' | 'group' | 'plots'

export type CostControlOptions = {
  projects: { id: string; name: string }[]
  plotGroups: { id: string; name: string; project_id: string }[]
  plots: { id: string; name: string; project_id: string }[]
}

function scopeMode(scope: ControlScope): ScopeMode {
  if (scope.plotIds && scope.plotIds.length > 0) return 'plots'
  if (scope.plotGroupId) return 'group'
  return 'project'
}

/** Same scope shape everywhere on this page (URL, RPCs, both tabs): a
 * project, optionally narrowed to a saved plot group or an ad-hoc plot
 * selection. Deep-linkable from the project page / plot group manager, so
 * this is a controlled component - the parent owns the URL. */
export default function ScopePicker({
  options,
  scope,
  onChange,
}: {
  options: CostControlOptions
  scope: ControlScope
  onChange: (scope: ControlScope) => void
}) {
  const mode = scopeMode(scope)
  const projectGroups = options.plotGroups.filter((g) => g.project_id === scope.projectId)
  const projectPlots = options.plots.filter((p) => p.project_id === scope.projectId)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px]">
        <label className="mb-1 block text-xs font-medium text-slate-500">โครงการ</label>
        <SearchableSelect
          value={scope.projectId}
          onChange={(projectId) => onChange({ projectId })}
          placeholder="-- เลือกโครงการ --"
          options={options.projects.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>

      {scope.projectId && (
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">ขอบเขต</label>
          <select
            value={mode}
            onChange={(e) => {
              const next = e.target.value as ScopeMode
              if (next === 'project') onChange({ projectId: scope.projectId })
              else if (next === 'group') onChange({ projectId: scope.projectId, plotGroupId: projectGroups[0]?.id || null })
              else onChange({ projectId: scope.projectId, plotIds: [] })
            }}
            className="w-full"
          >
            <option value="project">ทั้งโครงการ</option>
            <option value="group" disabled={projectGroups.length === 0}>
              กลุ่มแปลง
            </option>
            <option value="plots" disabled={projectPlots.length === 0}>
              เลือกแปลงเอง
            </option>
          </select>
        </div>
      )}

      {mode === 'group' && (
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">กลุ่มแปลง</label>
          <SearchableSelect
            value={scope.plotGroupId || ''}
            onChange={(plotGroupId) => onChange({ projectId: scope.projectId, plotGroupId })}
            placeholder="-- เลือกกลุ่มแปลง --"
            options={projectGroups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </div>
      )}

      {mode === 'plots' && (
        <div className="w-full">
          <label className="mb-1 block text-xs font-medium text-slate-500">เลือกแปลง (เลือกได้หลายแปลง)</label>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {projectPlots.map((p) => {
              const checked = (scope.plotIds || []).includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const current = scope.plotIds || []
                    const next = current.includes(p.id) ? current.filter((id) => id !== p.id) : [...current, p.id]
                    onChange({ projectId: scope.projectId, plotIds: next })
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    checked ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
