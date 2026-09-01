const PAGE_SIZE = 1000

/**
 * PostgREST caps any single response at the project's db.max_rows setting
 * (1000 by default) no matter how large a `.range()` is requested - a plain
 * `.select()` on a table past that size silently drops the tail instead of
 * erroring. material_types crossed 1169 rows and this is exactly how items
 * ranked past #1000 alphabetically (e.g. เหล็กตัวซี) disappeared from every
 * unpaginated picker and from the bulk-import duplicate-name check. This
 * loops `.range()` calls until a short page comes back, so callers get the
 * whole table regardless of how large it grows.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}
