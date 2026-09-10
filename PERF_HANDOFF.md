# Handoff: move page data loading from the client to the server

This is a work order for a follow-up session. Read it top to bottom before
editing anything. It is self-contained — you do not need the conversation
that produced it.

## Why

Every Supabase call from this app costs **145–306ms** of network round trip
(measured against the project's ap-south-1 region). The database itself is
tiny — the largest table is ~1,500 rows — so query plans are irrelevant here.
Latency is round trips, and the only way to reduce it is to make fewer of
them, or stop stacking them one after another.

31 of ~45 pages are `'use client'` and fetch their data in `useEffect`. That
forces this sequence on every navigation:

1. Server sends an empty page shell
2. Browser downloads and hydrates the JavaScript
3. *Only then* the page calls a server action to fetch its data
4. Data comes back, page finally renders

Steps 1 and 3 are two separate round trips that cannot overlap, because step 3
can't start until step 2 finishes. Moving the fetch into the server component
collapses them into one: the server fetches while it renders, and the page
arrives with its data already in it.

A previous pass already removed the auth round trips from this path (see
`lib/auth/route-access.ts`). This is the next-largest remaining win.

## The pattern to copy

`app/dashboard/procurement/orders/` is already done correctly. Copy it.

**Server page** (`page.tsx`) — fetches, catches errors, passes both down:

```tsx
import { getPurchaseOrders } from '@/actions/procurement-actions'
import PurchaseOrdersPageClient from './PurchaseOrdersPageClient'

export default async function PurchaseOrdersPage() {
  let orders: Awaited<ReturnType<typeof getPurchaseOrders>> = []
  let initialError: string | null = null
  try {
    orders = await getPurchaseOrders()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ'
  }

  return <PurchaseOrdersPageClient orders={orders} initialError={initialError} />
}
```

**Client component** (`XxxPageClient.tsx`) — takes data as props, surfaces the
error as a toast, keeps all interactivity:

```tsx
'use client'

export default function PurchaseOrdersPageClient({
  orders,
  initialError,
}: {
  orders: PurchaseOrder[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // ...filters, sorting, selection all stay here as useState
}
```

Rules that fall out of this:

- **The server page never has `'use client'`.** It is `async` and awaits directly.
- **Never throw from the server page.** Catch and pass `initialError` down, so a
  failed fetch renders the page with an error toast instead of the error boundary.
- **Filters, sorting, search, and selection stay client-side**, as `useState`.
  Do not move them into search params. They already work; leave them alone.
- **Keep the client file next to its page** as `XxxPageClient.tsx`, matching
  the existing naming.

## Trap 1 — pages that reload after saving (most common breakage)

Many of these pages define a `load()` function and call it again after a
mutation to refresh the list. Grep for `await load()`.

Once the data arrives as a prop, `load()` no longer owns it, so calling it does
nothing useful. Replace those calls with:

```tsx
router.refresh()
```

`router.refresh()` re-runs the server component and streams fresh props in,
without a full page reload or losing client state. This is what the reference
page does after duplicate/delete (`PurchaseOrdersPageClient.tsx`, ~lines 217
and 233).

**Watch for the variant:** some mutation handlers deliberately patch the row in
local state instead of refetching, to avoid re-rendering a 1,000-row table (see
the comment above the mutations in `actions/material-actions.ts`). Where you
find that, keep it — add `router.refresh()` only if the page was already
refetching.

## Trap 2 — report pages work differently

**Do not convert report pages the same way.** Check what their `useEffect`
actually loads before touching them.

The report pages under `app/dashboard/reports/` do **not** auto-load report
data on mount. On mount they load only the *filter options* (project list,
contractor list). The report itself runs when the user clicks a button
(`runReport`).

So for these, the correct change is narrow: **server-render the filter options
only**, and leave `runReport` exactly as it is on the client. That removes one
round trip before the dropdowns become usable. Do not try to pre-run the
report — it is user-driven and often heavy.

The same applies to `app/dashboard/stock/reports/page.tsx`, which *does*
auto-load both of its datasets on mount — that one is a normal conversion.

## Trap 3 — detail pages with an id

Routes like `app/dashboard/procurement/orders/[id]/page.tsx` currently read the
id with `useParams()`. In a server component, `params` is a promise and must be
awaited:

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // ...fetch by id, pass down as props
}
```

Pass the id down as a prop if the client component still needs it (for mutation
calls). Do not keep `useParams()` in the client component just to re-derive it.

## Order of work

Do these in batches of 3–4, and stop after each batch for verification. Do not
attempt all of them in one pass.

### Batch 1 — simplest, prove the pattern here first

| Page | Loader | Notes |
| --- | --- | --- |
| `settings/suppliers/page.tsx` | `getSuppliers` | has `load()` ×4 → `router.refresh()` |
| `settings/contractor-types/page.tsx` | `getContractorTypes` | |
| `settings/billing-info/page.tsx` | `getOrganizationSettings` | |
| `settings/financial-defaults/page.tsx` | `getOrganizationSettings` | |

### Batch 2 — same shape, slightly larger

| Page | Loader | Notes |
| --- | --- | --- |
| `settings/companies/page.tsx` | `getCompanies` | has `load()` ×4 |
| `settings/users/page.tsx` | `getUsers` | |
| `settings/permissions/page.tsx` | `getRolePermissions` | |
| `settings/signatures/page.tsx` | `getSignatureSlots` | |

### Batch 3 — lists with refresh-after-mutate

| Page | Loader | Notes |
| --- | --- | --- |
| `stock/movements/page.tsx` | `getStockMovements` | `load()` ×2 |
| `stock/reports/page.tsx` | `getLowStockMaterials` + `getConsumptionReport` | already `Promise.all`; keep it, move to server |
| `foreman/history/page.tsx` | `getBillingsByCreator` | `load()` ×4 |

### Batch 4 — detail pages (read Trap 3 first)

| Page | Loader | Notes |
| --- | --- | --- |
| `procurement/requests/[id]/page.tsx` | `getPurchaseRequestById` | only 67 lines — start here |
| `procurement/orders/[id]/page.tsx` | `getPurchaseOrderById` | `load()` ×6 |
| `stock/[materialId]/page.tsx` | `getMaterialStockDetail` | `load()` ×2 |

### Batch 5 — larger detail pages

| Page | Loader | Notes |
| --- | --- | --- |
| `boq/[id]/page.tsx` | `getBOQItems` | 498 lines |
| `projects/[id]/page.tsx` | `getPlotGroups` + `getPlotsByProjectId` | 534 lines; parallelize with `Promise.all` |
| `projects/[id]/[plotId]/page.tsx` | `getJobAssignments` | 410 lines |

### Batch 6 — reports (read Trap 2 first — options only)

`reports/dc-history`, `reports/house-history`, `reports/labor-budget`.

Note `dc-history` and `house-history` have a *second* `useEffect` that loads
plots when a project is selected. That is a genuine client-side cascade — leave
it on the client.

### Batch 7 — treat with care, or skip

- `settings/materials/page.tsx` (738 lines) — converts normally, **but** it
  calls `getMaterialTypes(false)`, which is `select('*')` over 1,353 rows
  ≈ **605KB per load**. Worth converting *and* trimming to the columns the
  table actually renders. Verify carefully; this page manages both active and
  deactivated rows.
- `billing/[id]/review/page.tsx` (661 lines) — three loaders in a `Promise.all`
  plus a dynamically imported PDF viewer. The PDF import must stay client-side.
- `billing/request/page.tsx` (573) and `foreman/create-dc/page.tsx` (354) —
  forms driven by `useSearchParams` for edit-vs-create mode. Trickiest of the
  set. Leave for last.
- `reports/contractor-cycle/page.tsx` — **1,745 lines, the largest file in the
  repo.** Do not touch it as part of this work. It deserves its own session.

## Not worth converting (no data fetch on mount)

- `app/set-password/page.tsx` — reads the session client-side by design. Leave it.
- `app/dashboard/procurement/orders/create/page.tsx` — thin `Suspense` wrapper,
  fetches nothing. Leave it.
- `app/dashboard/settings/page.tsx` — a static link menu. It fetches nothing and
  uses no hooks, so `'use client'` can simply be **deleted** for a small bundle
  win. Safe, unrelated to the rest.
- `app/dashboard/foreman/page.tsx` — 14 lines that `router.replace()` to
  `/dashboard/foreman/create-progress` after hydrating. Replace the whole file
  with a server-side `redirect()` from `next/navigation`. Removes a visible
  flash and a client round trip.

## How to verify each batch

1. `npx tsc --noEmit -p tsconfig.json` — must be clean.
2. `npx eslint <changed files>` — must be clean.
3. `npx next build` — must succeed.
4. **Ask the user to click through the changed pages while logged in.**

Step 4 is not optional and cannot be skipped or substituted. No agent in this
project can log in — minting a session needs the service-role key, and the
auto-mode classifier blocks scripts that read it. The build passing does **not**
prove these pages work, because the only thing that exercises them is an
authenticated session.

For each converted page confirm: it loads with data, it still filters/sorts,
and **saving something still updates the list** (that is Trap 1, and it is the
failure you are most likely to introduce).

If the user has `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` etc. configured, the
existing `tests/e2e/deployment-smoke.spec.ts` and `role-access.spec.ts` cover
route access and can be run with `npm run test:e2e`.

## Do not touch

- **`lib/auth/route-access.ts`, `actions/_shared/user-role.ts`, `middleware.ts`** —
  these were just rewritten to verify JWTs locally instead of calling the auth
  server. Leave them alone.
- **The RLS policies on `billings`, `billing_jobs`, `billing_adjustments`.**
  They each carry a permissive `"Allow all"` policy alongside the real
  `*_select` policy, which cancels out the intended row filtering. This is a
  known open security issue, deliberately left for a separate decision — fixing
  it changes who can see what and needs testing. Not part of this work.
- **`actions/dashboard-actions.ts`** — `getDashboardStats()` pulls ~460KB per
  dashboard load to compute ~10 numbers and should become a Postgres aggregate,
  but it is dense business logic and belongs in its own session.
