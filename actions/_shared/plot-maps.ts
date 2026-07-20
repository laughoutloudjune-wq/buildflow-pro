type PlotNameRow = {
  id: string
  name: string | null
}

type PlotDetailRow = PlotNameRow & {
  house_models: {
    name: string | null
    code: string | null
  } | null
}

type PlotQueryBuilder = {
  from: (table: string) => {
    select: (query: string) => {
      in: (column: string, ids: string[]) => PromiseLike<{
        data: PlotNameRow[] | PlotDetailRow[] | null
        error: { message: string } | null
      }>
    }
  }
}

export async function getPlotNameMap(supabase: unknown, plotIds: (string | null | undefined)[]) {
  const client = supabase as PlotQueryBuilder
  const ids = Array.from(new Set((plotIds || []).filter(Boolean))) as string[]
  if (ids.length === 0) return new Map<string, string>()
  const { data, error } = await client.from('plots').select('id, name').in('id', ids)
  if (error) throw new Error(error.message)
  return new Map(((data || []) as PlotNameRow[]).map((p) => [p.id, p.name || '']))
}

export async function getPlotDetailMap(supabase: unknown, plotIds: (string | null | undefined)[]) {
  const client = supabase as PlotQueryBuilder
  const ids = Array.from(new Set((plotIds || []).filter(Boolean))) as string[]
  if (ids.length === 0) return new Map<string, PlotDetailRow>()
  const { data, error } = await client
    .from('plots')
    .select('id, name, house_models (name, code)')
    .in('id', ids)
  if (error) throw new Error(error.message)
  return new Map(((data || []) as PlotDetailRow[]).map((p) => [p.id, p]))
}

type BillingJobWithPlot = {
  job_assignments?: {
    plots?: { name?: string | null } | null
  } | null
}

/**
 * Progress billings often have no plot_id of their own — the plot lives on
 * each line item (billing_jobs -> job_assignments -> plots), since one
 * progress billing can cover several plots. DC/extra-work billings, by
 * contrast, are created against a single plot_id directly. Without this
 * fallback, a progress billing with no plot_id renders as "plot not
 * specified" even though every line item clearly names a plot.
 */
export function derivePlotLabelFromJobs(billingJobs: BillingJobWithPlot[] | null | undefined): string | null {
  const names = Array.from(
    new Set(
      (billingJobs || [])
        .map((job) => job.job_assignments?.plots?.name)
        .filter((name): name is string => !!name)
    )
  )
  if (names.length === 0) return null
  return names.join(', ')
}
