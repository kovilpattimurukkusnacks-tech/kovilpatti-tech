import { Fragment, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { formatIstDateTime } from '../../utils/formatDate'
import { BRAND_NAME } from '../../utils/brand'
import { useAutoPrint, PrintButton } from '../../hooks/useAutoPrint'
import './print.css'

// Brand block — mirrors the thermal receipt + per-request picklist so all
// three printouts feel like the same family. Contact phone is per-shop on
// the picklist; cumulative is cross-shop so we omit it here.

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
  const { data: rows, isLoading, error } = useCumulativePending(invId)

  // Fire the print dialog ONCE per page life — see useAutoPrint for why the
  // ref guard is needed (React Query refetches / StrictMode double-invoke).
  useAutoPrint(!!rows)

  // Two-level grouping: category → weight → SKUs. Per-category subtotals
  // are computed in the render so the kitchen sees "Snacks · 4 SKUs · 850
  // units" at the head of each section and which weight buckets are open.
  const sections = useMemo(
    () => groupByCategoryWeight(
      rows ?? [],
      r => ({ category: r.categoryName, weightValue: r.weightValue, weightUnit: r.weightUnit }),
    ),
    [rows],
  )

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
      {/* Centred brand header — same shape as the per-request picklist
          + the thermal receipt. Contact line is omitted because this print
          spans every shop. */}
      <header className="print-brand-header">
        <div className="print-brand-name">{BRAND_NAME}</div>
        <div className="print-brand-subtitle">Cumulative Batch Plan</div>
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

      {sections.length === 0 ? (
        <p style={{ marginTop: 32 }}>No in-progress requests right now — nothing to prepare.</p>
      ) : (
        <>
          {/* Two-column flow — categories stack down two side-by-side columns
              for paper density. Each section's break-inside:avoid keeps a
              category together when possible. Columns 4 cells wide:
              # / product / type / qty. From-Requests dropped per row and
              surfaced in the page header + summary instead. */}
          <div className="print-dense-grid">
            {sections.map(section => {
              const skuCount    = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
              const subtotalQty = section.weightGroups.reduce(
                (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0)
              return (
                <section key={section.category} className="print-dense-section">
                  <div className="print-dense-banner">
                    {section.category}
                    <span className="muted">
                      · {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
                      · {subtotalQty} units
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
                                  <td style={{ textAlign: 'right' }} className="strong">{r.totalQty}</td>
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
            })}
          </div>

          {/* Compact grand-totals strip below the column grid. The printed
              timestamp is folded into the muted right column so the standalone
              footer can stay hidden on print — that footer's top margin +
              border was tipping a near-full last page into a second sheet. */}
          <div className="print-dense-summary">
            <span>
              {totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'}
              <span className="muted"> · {sections.length} {sections.length === 1 ? 'category' : 'categories'}</span>
            </span>
            <span>
              {totalUnits} units
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

      {/* Footer with Print button — visible on-screen only. The "Printed at"
          line already lives inside the dense-summary strip above. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <PrintButton className="print-trigger" />
        </div>
      </footer>
    </div>
  )
}
