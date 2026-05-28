import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { DispatchedCell } from '../../components/DispatchedCell'
import { formatINR } from '../../utils/format'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

/**
 * Single-request picklist. Standalone route, no sidebar/header chrome,
 * auto-triggers the browser print dialog once the data lands. User can
 * "Save as PDF" from the browser print dialog.
 */
export default function PrintRequestPicklist() {
  const { id } = useParams<{ id: string }>()
  const { data: request, isLoading, error } = useStockRequest(id)

  // Auto-open the browser print dialog ONCE when the data is ready.
  // Without this ref guard, React Query data refetches (or StrictMode
  // double-invoke in dev) can queue multiple window.print() calls — which
  // leaves "ghost" dialogs that lock both this tab and its opener.
  const printedRef = useRef(false)
  useEffect(() => {
    if (!request || printedRef.current) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [request])

  // Compute the delivered amount client-side so it always matches the items
  // table (totalDispatchedAmount on the DTO is null until dispatch happens).
  const deliveredAmount = useMemo(() => {
    if (!request) return 0
    return (request.items ?? []).reduce(
      (sum, it) => sum + (it.dispatchedQty ?? it.requestedQty) * it.unitPrice,
      0,
    )
  }, [request])

  // Two-level grouping for the picklist: category → weight → items. The
  // kitchen scans one weight bucket at a time within each category.
  const sections = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request],
  )

  if (isLoading) return <div className="print-page"><p>Loading…</p></div>
  if (error || !request) {
    return (
      <div className="print-page">
        <p>Could not load request.</p>
      </div>
    )
  }

  const hasDispatch = request.totalDispatchedQty != null
  const isShort = hasDispatch && deliveredAmount < request.totalAmount

  return (
    <div className="print-page">
      {/* Centered title bar with status pill underneath; timestamps live on
          a separate row on the right so the title can dominate visually. */}
      <header className="print-header print-header-centered">
        <div className="print-title-block">
          <h1 className="print-title">Stock Request — Picklist</h1>
          <div className="print-meta">
            <strong>{request.code}</strong> · {request.status}
          </div>
        </div>
        <div className="print-meta-right">
          <div><span className="muted">Requested:</span> {formatIstDateTime(request.submittedAt)}</div>
          {request.dispatchedAt && (
            <div><span className="muted">Dispatched:</span> {formatIstDateTime(request.dispatchedAt)}</div>
          )}
        </div>
      </header>

      {/* Shop on the left, Inventory on the right edge of the page. */}
      <section className="print-parties">
        <div>
          <div className="muted">Shop</div>
          <div className="strong">{request.shopCode} — {request.shopName}</div>
          {request.submittedByName && (
            <div className="small">Requested by {request.submittedByName}</div>
          )}
        </div>
        <div className="print-parties-right">
          <div className="muted">Inventory</div>
          <div className="strong">{request.inventoryCode} — {request.inventoryName}</div>
          {request.dispatchedByName && (
            <div className="small">Dispatched by {request.dispatchedByName}</div>
          )}
        </div>
      </section>

      {/* Items — dense 2-column flow (same compression as the cumulative
          report). Each category sits in its own section with a slim banner
          and a tight 4-column table: # / product / requested / dispatched.
          break-inside:avoid keeps each category together where possible. */}
      <div className="print-dense-grid">
        {sections.map(section => {
          const sectionQty = section.weightGroups.reduce(
            (s, wg) => s + wg.items.reduce((a, it) => a + it.requestedQty, 0), 0)
          const productCount = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
          return (
            <section key={section.category} className="print-dense-section">
              <div className="print-dense-banner">
                {section.category}
                <span className="muted">
                  · {productCount} {productCount === 1 ? 'product' : 'products'}
                  · {sectionQty} units
                </span>
              </div>
              <table className="print-dense-table">
                <colgroup>
                  <col style={{ width: 22 }} />
                  <col />
                  <col style={{ width: 44 }} />
                  <col style={{ width: 56 }} />
                </colgroup>
                <tbody>
                  {section.weightGroups.map(wg => {
                    let idx = 0
                    return (
                      <Fragment key={`${section.category}__${wg.label}`}>
                        <tr className="print-weight-row-dense">
                          <td colSpan={4}>{wg.label}</td>
                        </tr>
                        {wg.items.map(it => {
                          idx++
                          return (
                            <tr key={it.id}>
                              <td>{idx}</td>
                              <td><strong>{it.productName}</strong></td>
                              <td style={{ textAlign: 'right' }}>{it.requestedQty}</td>
                              <td style={{ textAlign: 'right' }}>
                                <DispatchedCell qty={it.dispatchedQty} requested={it.requestedQty} />
                              </td>
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

      {/* Grand totals strip — compact, full width below the column grid. */}
      <div className="print-dense-summary">
        <span>
          Total
          <span className="muted"> · {sections.length} {sections.length === 1 ? 'category' : 'categories'}</span>
        </span>
        <span>
          Requested {request.totalQty}
          {request.totalDispatchedQty != null && (
            <>
              <span className="muted"> · </span>
              Dispatched {request.totalDispatchedQty}
            </>
          )}
        </span>
      </div>

      {/* Money totals — printed below the picklist so the kitchen / godown
          has both quantity AND amount on the same sheet. Delivered line is
          only rendered post-dispatch; it goes red if it's short of requested. */}
      <section className="print-summary">
        <div className="print-summary-row">
          <span className="muted">Requested quantity</span>
          <span className="strong">{request.totalQty} {request.totalQty === 1 ? 'unit' : 'units'}</span>
        </div>
        <div className="print-summary-row">
          <span className="muted">Requested amount</span>
          <span className="strong">{formatINR(request.totalAmount)}</span>
        </div>
        {hasDispatch && (
          <>
            <div className="print-summary-divider" />
            <div className="print-summary-row">
              <span className="muted">Dispatched quantity</span>
              <span className={'strong' + (isShort ? ' danger' : '')}>
                {request.totalDispatchedQty} {request.totalDispatchedQty === 1 ? 'unit' : 'units'}
              </span>
            </div>
            <div className="print-summary-row">
              <span className="muted">Dispatched amount</span>
              <span className={'strong' + (isShort ? ' danger' : '')}>
                {formatINR(deliveredAmount)}
              </span>
            </div>
          </>
        )}
      </section>

      {request.notes && (
        <section className="print-notes">
          <div className="muted">Shop's notes</div>
          <div>{request.notes}</div>
        </section>
      )}

      <footer className="print-footer">
        <div>Printed {formatIstDateTime(new Date())}</div>
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
