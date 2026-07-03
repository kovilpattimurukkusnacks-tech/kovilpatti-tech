import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { splitBalancedColumns } from '../../utils/balancedColumns'
import { useCategories } from '../../hooks/useCategories'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

const heightOfCatGroup = (cg: { weightGroups: { items: unknown[] }[] }) =>
  1 + cg.weightGroups.reduce((s, wg) => s + 1 + wg.items.length, 0)

// Brand block — mirrors the thermal receipt + per-request picklist so all
// three printouts feel like the same family. Contact phone is per-shop on
// the picklist; cumulative is cross-shop so we omit it here.
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

/**
 * Cumulative in-progress workload — one batch-plan report covering every
 * Approved (= "In-Progress") request in the caller's inventory. Admin may
 * pass ?inventoryId= in the URL; inventory user's own scope is enforced
 * server-side.
 *
 * Why Approved and not Pending: once a request is Approved, the shop can no
 * longer edit it — so the totals here are stable while the kitchen packs.
 * (Client ask, 26 May 2026 demo.)
 *
 * SKUs are grouped under their category so the kitchen can plan each
 * production line in one pass (all Snacks together, all Biscuits together…).
 */
export default function PrintCumulative() {
  const [params] = useSearchParams()
  const invId = params.get('inventoryId') ?? undefined
  // requestIds param — comma-separated UUIDs. Empty/omitted → every Approved
  // request in scope (legacy behaviour). Populated → cumulate only those.
  const requestIds = params.get('requestIds')?.split(',').map(s => s.trim()).filter(Boolean)
  // Shop names (comma-joined) passed alongside requestIds so the header
  // reads "Anna Nagar" / "Ambatur, Anna Nagar" — makes the batch plan
  // unambiguous when a single godown packs for multiple shops. 03-Jul-2026.
  const shopNamesParam = params.get('shopNames')?.trim() ?? ''
  const { data: rows, isLoading, error } = useCumulativePending(invId, requestIds)

  // Fire the print dialog ONCE per page life. Without this guard, React
  // Query data refetches (or StrictMode double-invoke) can queue multiple
  // window.print() calls — which leaves stuck dialogs that lock the opener.
  const printedRef = useRef(false)
  useEffect(() => {
    if (!rows || printedRef.current) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [rows])

  // Two-level grouping: sub-category (leaf) → weight → SKUs.
  const sections = useMemo(
    () => groupByCategoryWeight(
      rows ?? [],
      r => ({ category: r.categoryName, weightValue: r.weightValue, weightUnit: r.weightUnit }),
    ),
    [rows],
  )

  // 30-Jun-2026 — bucket sections under their ROOT category in hard-coded
  // priority order (1 KG Snacks → Packing Items → … → Shop Needs). Each
  // root prints as its own block with an underline heading + a 2-col grid
  // of its sub-cat cards. Mirrors the per-request picklist + the 3-inch
  // thermal slip so the kitchen sees the same hierarchy everywhere.
  const categoriesQuery = useCategories()
  const rootGroups = useMemo(() => {
    const lookup = buildRootLookup(categoriesQuery.data)
    const byRoot = new Map<string, typeof sections>()
    for (const sec of sections) {
      const root = lookup(sec.category)
      const arr = byRoot.get(root)
      if (arr) arr.push(sec)
      else byRoot.set(root, [sec])
    }
    return sortRootCategoryNames(Array.from(byRoot.keys()))
      .map(root => {
        const children = byRoot.get(root)!
        const skuCount = children.reduce(
          (sum, sec) => sum + sec.weightGroups.reduce((s, wg) => s + wg.items.length, 0),
          0,
        )
        const unitCount = children.reduce(
          (sum, sec) => sum + sec.weightGroups.reduce(
            (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0), 0)
        return { root, children, skuCount, unitCount }
      })
  }, [sections, categoriesQuery.data])

  // Grand totals across all categories — shown in the footer.
  const { totalUnits, totalRequests, totalSkus } = useMemo(() => {
    if (!rows) return { totalUnits: 0, totalRequests: 0, totalSkus: 0 }
    let units = 0
    let maxReq = 0
    for (const r of rows) {
      units += r.totalQty
      if (r.requestCount > maxReq) maxReq = r.requestCount
    }
    return { totalUnits: units, totalRequests: maxReq, totalSkus: rows.length }
  }, [rows])

  if (isLoading) return <div className="print-page"><p>Loading…</p></div>
  if (error || !rows) {
    return (
      <div className="print-page">
        <p>Could not load cumulative report.</p>
      </div>
    )
  }

  return (
    <div className="print-page">
      {/* Wrap whole sheet in a 1-column <table> so the <thead> block
          (brand header + meta strip) repeats at the top of every printed
          page when the kitchen plan spans multiple sheets (30-Jun-2026
          client req). Screen view is unaffected — table renders as one
          continuous flow on screen. */}
      <table className="print-page-table">
        <thead>
          <tr>
            <td>
              <header className="print-brand-header">
                <div className="print-brand-name">{BRAND_NAME}</div>
                <div className="print-brand-subtitle">Cumulative Batch Plan</div>
                {/* Shop names — only when caller narrowed to specific shops.
                    03-Jul-2026 client req. Comma-joined for multi-shop
                    prints so the picker at the godown knows exactly which
                    shops this batch covers. */}
                {shopNamesParam && (
                  <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: 2, color: '#7C4A00' }}>
                    {shopNamesParam}
                  </div>
                )}
              </header>

              <div className="print-meta-strip">
                <div>
                  <span className="muted">Generated: </span>
                  {formatIstDateTime(new Date())}
                </div>
                {totalRequests > 0 && (
                  <div>
                    <span className="muted">Sourced from: </span>
                    up to <strong>{totalRequests}</strong> request{totalRequests === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
      {sections.length === 0 ? (
        <p style={{ marginTop: 32 }}>No in-progress requests right now — nothing to prepare.</p>
      ) : (
        <>
          {/* Items grouped by ROOT category in hard-coded priority order.
              Each root block: an underline-style heading on top, then its
              sub-cat banner cards flow into a 2-col grid below. Mirrors the
              per-request picklist + the 3-inch thermal slip so the kitchen
              sees the same hierarchy everywhere. */}
          {rootGroups.map(rg => {
            const { left, right } = splitBalancedColumns(rg.children, heightOfCatGroup)
            const renderCard = (section: typeof rg.children[number]) => {
              const skuCount    = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
              const subtotalQty = section.weightGroups.reduce(
                (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0)
              return (
                <section key={section.category} className="print-dense-section">
                  <div className="print-dense-banner">
                    {section.category}
                    <span className="muted">
                      · {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
                      · {subtotalQty.toLocaleString('en-IN')} units
                    </span>
                  </div>
                  <table className="print-dense-table">
                    <colgroup>
                      <col style={{ width: 22 }} />
                      <col />
                      <col style={{ width: 60 }} />
                      <col style={{ width: 48 }} />
                    </colgroup>
                    <tbody>
                      {section.weightGroups.map(wg => {
                        let idx = 0
                        return (
                          <Fragment key={`${section.category}__${wg.label}`}>
                            <tr className="print-weight-row-dense">
                              <td colSpan={4}>{wg.label}</td>
                            </tr>
                            {wg.items.map(r => {
                              idx++
                              return (
                                <tr key={`${r.productId}-${r.weightValue ?? 'x'}-${r.weightUnit ?? ''}`}>
                                  <td>{idx}</td>
                                  <td><strong>{r.productName}</strong></td>
                                  <td>{r.type}</td>
                                  <td style={{ textAlign: 'right' }} className="strong">{r.totalQty.toLocaleString('en-IN')}</td>
                                </tr>
                              )
                            })}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </section>
              )
            }
            return (
              <table key={rg.root} className="print-root-section">
                <thead>
                  <tr><td>
                    <h2 className="print-root-heading">
                      {rg.root}
                      <span className="muted">
                        · {rg.skuCount} {rg.skuCount === 1 ? 'SKU' : 'SKUs'}
                        · {rg.unitCount.toLocaleString('en-IN')} units
                      </span>
                    </h2>
                  </td></tr>
                </thead>
                <tbody>
                  <tr><td>
                    <div className="print-dense-grid">
                      <div className="print-dense-col">{left.map(renderCard)}</div>
                      <div className="print-dense-col">{right.map(renderCard)}</div>
                    </div>
                  </td></tr>
                </tbody>
              </table>
            )
          })}

          {/* Compact grand-totals strip below the root sections. */}
              <div className="print-dense-summary">
                <span>
              {totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'}
              <span className="muted"> · {rootGroups.length} {rootGroups.length === 1 ? 'category' : 'categories'} ({sections.length} sub)</span>
            </span>
            <span>
              {totalUnits.toLocaleString('en-IN')} units
              {totalRequests > 0 && (
                <span className="muted">
                  {' '}· from up to {totalRequests} request{totalRequests === 1 ? '' : 's'}
                </span>
              )}
              <span className="muted"> · printed {formatIstDateTime(new Date())}</span>
            </span>
          </div>
        </>
      )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer with Print button — visible on-screen only. Sits OUTSIDE the
          repeating-header table so the button doesn't print as page chrome. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
