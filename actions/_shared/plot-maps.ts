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
