'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Boxes } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import SearchableSelect from '@/components/ui/SearchableSelect'
import JobMaterialLogModal from '@/components/materials/JobMaterialLogModal'
import { getBillingOptions } from '@/actions/billing-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getJobAssignments } from '@/actions/job-actions'

type ProjectOption = { id: string; name: string }
type PlotOption = { id: string; name: string; house_models?: { name: string } | null }
type JobRow = {
  id: string
  status: string
  boq_master?: { item_name?: string; unit?: string; quantity?: number } | null
  contractors?: { name?: string } | null
}

export default function ForemanMaterialsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [plots, setPlots] = useState<PlotOption[]>([])
  const [jobs, setJobs] = useState<JobRow[]>([])

  // Seeded from the URL so navigating away (e.g. to submit a billing request)
  // and back - or bookmarking/sharing the link - doesn't lose the selection.
  const [selectedProject, setSelectedProject] = useState(() => searchParams.get('projectId') || '')
  const [selectedPlot, setSelectedPlot] = useState(() => searchParams.get('plotId') || '')

  const [materialsJob, setMaterialsJob] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedProject) params.set('projectId', selectedProject)
    if (selectedPlot) params.set('plotId', selectedPlot)
    const qs = params.toString()
    router.replace(qs ? `/dashboard/foreman/materials?${qs}` : '/dashboard/foreman/materials', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedPlot])

  useEffect(() => {
    getBillingOptions().then(({ projects }) => setProjects(projects || []))
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => {
      if (!selectedProject) {
        setPlots([])
        setSelectedPlot('')
        return
      }
      getPlotsByProjectId(selectedProject).then((data) => setPlots(data || []))
    })
  }, [selectedProject])

  useEffect(() => {
    Promise.resolve().then(() => {
      if (!selectedPlot) {
        setJobs([])
        return
      }
      getJobAssignments(selectedPlot).then((data) => setJobs(data || []))
    })
  }, [selectedPlot])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">บันทึกวัสดุ</h1>
        <p className="mt-1 text-sm text-slate-500">
          เลือกโครงการและแปลง แล้วกดบันทึกวัสดุที่งานที่ต้องการเทียบกับงบ BOQ
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">โครงการ</label>
            <SearchableSelect
              value={selectedProject}
              onChange={setSelectedProject}
              placeholder="เลือกโครงการ"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">แปลง</label>
            <SearchableSelect
              value={selectedPlot}
              onChange={setSelectedPlot}
              placeholder="เลือกแปลง"
              disabled={!selectedProject}
              options={plots.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.house_models?.name || undefined,
              }))}
            />
          </div>
        </div>
      </Card>

      {selectedPlot && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">รายการงาน</th>
                  <th className="px-4 py-3 font-semibold">ผู้รับเหมา</th>
                  <th className="px-4 py-3 font-semibold">สถานะ</th>
                  <th className="w-[120px] px-4 py-3 text-center font-semibold">วัสดุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      แปลงนี้ยังไม่มีรายการงาน
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{job.boq_master?.item_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{job.contractors?.name || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{job.status}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setMaterialsJob({ id: job.id, label: job.boq_master?.item_name || 'งาน' })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <Boxes className="h-3.5 w-3.5" /> บันทึก
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {materialsJob && (
        <JobMaterialLogModal
          isOpen={Boolean(materialsJob)}
          onClose={() => setMaterialsJob(null)}
          jobAssignmentId={materialsJob.id}
          jobLabel={materialsJob.label}
        />
      )}
    </div>
  )
}
