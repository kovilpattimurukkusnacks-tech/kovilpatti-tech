import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import type { CumulativePendingLine } from '../../api/stock-requests/types'
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

  // Group rows by category and pre-compute per-category subtotals so the
  // kitchen sees "Snacks: 4 SKUs · 850 units" at the head of each section.
  const sections = useMemo(() => {
    if (!rows) return []
    const buckets = new Map<string, CumulativePendingLine[]>()
    for (const r of rows) {
      const key = r.categoryName || 'Uncategorised'
      const arr = buckets.get(key)
      if (arr) arr.push(r)
      else buckets.set(key, [r])
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items,
        subtotalQty: items.reduce((s, r) => s + r.totalQty, 0),
        skuCount: items.length,
      }))
  }, [rows])

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
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Product</th>
              <th>Type</th>
              <th style={{ width: 80, textAlign: 'right' }}>Weight</th>
              <th style={{ width: 110, textAlign: 'right' }}>Total Qty</th>
              <th style={{ width: 110, textAlign: 'right' }}>From Requests</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              <Fragment key={section.category}>
                <tr className="print-section-row">
                  <td colSpan={6}>
                    <span className="strong">{section.category}</span>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      · {section.skuCount} {section.skuCount === 1 ? 'SKU' : 'SKUs'}
                      · {section.subtotalQty} units
                    </span>
                  </td>
                </tr>
                {section.items.map((r, i) => (
                  <tr key={`${r.productId}-${r.weightValue ?? 'x'}-${r.weightUnit ?? ''}`}>
                    <td>{i + 1}</td>
                    <td>
                      <strong>{r.productCode}</strong> — {r.productName}
                    </td>
                    <td>{r.type}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.weightValue != null ? `${r.weightValue} ${r.weightUnit ?? ''}`.trim() : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="strong">{r.totalQty}</td>
                    <td style={{ textAlign: 'right' }}>{r.requestCount}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="strong" style={{ textAlign: 'right' }}>
                {totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'} across {sections.length} {sections.length === 1 ? 'category' : 'categories'}
              </td>
              <td className="strong" style={{ textAlign: 'right' }}>{totalUnits} units</td>
              <td />
            </tr>
          </tfoot>
        </table>
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
