import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import './print.css'

/**
 * Cumulative pending workload — one batch-plan report covering every
 * Pending request in the caller's inventory. Admin may pass ?inventoryId=
 * in the URL; inventory user's own scope is enforced server-side.
 *
 * SKUs are grouped under their category so the kitchen can plan each
 * production line in one pass (all Snacks together, all Biscuits together…).
 */
export default function PrintCumulative() {
  const [params] = useSearchParams()
  const invId = params.get('inventoryId') ?? undefined
  const { data: rows, isLoading, error } = useCumulativePending(invId)

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
      <header className="print-header">
        <div>
          <h1 className="print-title">Cumulative Pending — Batch Plan</h1>
          <div className="print-meta">All Pending requests, grouped by category</div>
        </div>
        <div className="print-meta-right">
          <div><span className="muted">Generated:</span> {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
          {totalRequests > 0 && (
            <div><span className="muted">Sourced from:</span> up to {totalRequests} request{totalRequests === 1 ? '' : 's'}</div>
          )}
        </div>
      </header>

      {sections.length === 0 ? (
        <p style={{ marginTop: 32 }}>No pending requests right now — nothing to prepare.</p>
      ) : (
        <>
          {/* Column legend at the top — shown once so the reader knows what
              the numbers in each card mean. */}
          <table className="print-table" style={{ marginBottom: 8 }}>
            <colgroup>
              <col style={{ width: 50 }} />
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Total Qty</th>
                <th style={{ textAlign: 'right' }}>From Requests</th>
              </tr>
            </thead>
          </table>

          {sections.map(section => {
            const skuCount    = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
            const subtotalQty = section.weightGroups.reduce(
              (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0)
            return (
              <div key={section.category} className="print-card">
                <div className="print-card-header">
                  {section.category}
                  <span className="muted">
                    · {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
                    · {subtotalQty} units
                  </span>
                </div>
                <table className="print-table">
                  <colgroup>
                    <col style={{ width: 50 }} />
                    <col />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 130 }} />
                  </colgroup>
                  <tbody>
                    {section.weightGroups.map(wg => {
                      let idx = 0
                      return (
                        <Fragment key={`${section.category}__${wg.label}`}>
                          <tr className="print-weight-row">
                            <td colSpan={5}>{wg.label}</td>
                          </tr>
                          {wg.items.map(r => {
                            idx++
                            return (
                              <tr key={`${r.productId}-${r.weightValue ?? 'x'}-${r.weightUnit ?? ''}`}>
                                <td>{idx}</td>
                                <td><strong>{r.productName}</strong></td>
                                <td>{r.type}</td>
                                <td style={{ textAlign: 'right' }} className="strong">{r.totalQty}</td>
                                <td style={{ textAlign: 'right' }}>{r.requestCount}</td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Grand totals strip below all category cards. */}
          <table className="print-table" style={{ marginTop: 4 }}>
            <colgroup>
              <col style={{ width: 50 }} />
              <col />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <tfoot>
              <tr>
                <td colSpan={3} className="strong" style={{ textAlign: 'right' }}>
                  {totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'} across {sections.length} {sections.length === 1 ? 'category' : 'categories'}
                </td>
                <td className="strong" style={{ textAlign: 'right' }}>{totalUnits} units</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}

      <footer className="print-footer">
        <div>Printed {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
