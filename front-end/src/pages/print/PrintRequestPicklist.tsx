import { useMemo, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { DispatchedCell } from '../../components/DispatchedCell'
import { formatINR } from '../../utils/format'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { formatIstDateTime } from '../../utils/formatDate'
import { computeDeliveredAmount } from '../../utils/computeDeliveredAmount'
import { BRAND_NAME } from '../../utils/brand'
import { useAutoPrint, PrintButton } from '../../hooks/useAutoPrint'
import './print.css'

// Brand block — mirrors the thermal receipt's centred header so admin/godown
// prints feel like the same product. Name stays constant; contact comes from
// the request's shopContactPhone (per-shop), falling back to em-dash.

/**
 * Single-request picklist. Standalone route, no sidebar/header chrome,
 * auto-triggers the browser print dialog once the data lands. User can
 * "Save as PDF" from the browser print dialog.
 */
export default function PrintRequestPicklist() {
  const { id } = useParams<{ id: string }>()
  const { data: request, isLoading, error } = useStockRequest(id)

  // Auto-open the browser print dialog ONCE when the data is ready — see
  // useAutoPrint for why the ref guard is needed (React Query refetches /
  // StrictMode double-invoke in dev would otherwise queue "ghost" dialogs
  // that lock both this tab and its opener).
  useAutoPrint(!!request)

  // Compute the delivered amount client-side so it always matches the items
  // table (totalDispatchedAmount on the DTO is null until dispatch happens).
  const deliveredAmount = useMemo(() => computeDeliveredAmount(request?.items), [request])

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
      {/* Centred brand header — mirrors the thermal receipt style. Subtitle
          flips to "RETURN BILL" on Return-type requests. Below the rule, a
          single meta strip carries every shop / godown / who / when fact so
          the old parties block + timestamps row collapse into one band. */}
      <header className="print-brand-header">
        <div className="print-brand-name">{BRAND_NAME}</div>
        <div className="print-brand-contact">
          Contact: {request.shopContactPhone ?? '—'}
        </div>
        <div className="print-brand-subtitle">
          {request.requestType === 'Return' ? 'Return Bill' : 'Stock Request'}
        </div>
      </header>

      <div className="print-meta-strip">
        <div>
          <span className="muted">Code: </span>
          <strong>{request.code}</strong>
          <span className="muted"> · {request.status}</span>
        </div>
        <div>
          <span className="muted">Shop: </span>
          <strong>{request.shopName}</strong>
          {request.submittedByName && (
            <span className="muted"> · by {request.submittedByName}</span>
          )}
        </div>
        <div>
          <span className="muted">Godown: </span>
          <strong>{request.inventoryName}</strong>
        </div>
        <div>
          <span className="muted">Submitted: </span>
          {formatIstDateTime(request.submittedAt)}
          {request.dispatchedAt && (
            <>
              <span className="muted"> · Dispatched: </span>
              {formatIstDateTime(request.dispatchedAt)}
            </>
          )}
        </div>
      </div>

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
              {/* 5-col dense table — # / product / req / disp / amount.
                  Amount is qty × unit_price; qty = dispatchedQty when set
                  (post-dispatch), else requestedQty (pre-dispatch). */}
              <table className="print-dense-table">
                <colgroup>
                  <col style={{ width: 20 }} />
                  <col />
                  <col style={{ width: 32 }} />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 56 }} />
                </colgroup>
                <tbody>
                  {section.weightGroups.map(wg => {
                    let idx = 0
                    return (
                      <Fragment key={`${section.category}__${wg.label}`}>
                        <tr className="print-weight-row-dense">
                          <td colSpan={5}>{wg.label}</td>
                        </tr>
                        {wg.items.map(it => {
                          idx++
                          const effQty = it.dispatchedQty ?? it.requestedQty
                          const lineAmt = effQty * it.unitPrice
                          return (
                            <tr key={it.id}>
                              <td>{idx}</td>
                              <td><strong>{it.productName}</strong></td>
                              <td style={{ textAlign: 'right' }}>{it.requestedQty}</td>
                              <td style={{ textAlign: 'right' }}>
                                <DispatchedCell qty={it.dispatchedQty} requested={it.requestedQty} />
                              </td>
                              <td style={{ textAlign: 'right' }} className="strong">
                                {formatINR(lineAmt, { prefix: false })}
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

      {/* Single compact totals strip — quantities on the left, money on
          the right. Post-dispatch shows the delivered numbers; pre-dispatch
          shows the requested ones. The printed timestamp is folded into the
          right column's muted suffix so the standalone footer can stay hidden
          on print — same fix the cumulative page uses to avoid a near-full
          last page overflowing onto a second sheet. */}
      <div className="print-dense-summary">
        <span>
          {hasDispatch ? 'Dispatched' : 'Requested'}
          <span className="muted"> · </span>
          <strong>{hasDispatch ? request.totalDispatchedQty : request.totalQty}</strong> units
          <span className="muted"> · {sections.length} {sections.length === 1 ? 'category' : 'categories'}</span>
        </span>
        <span className={isShort ? 'danger' : ''}>
          <strong>{formatINR(hasDispatch ? deliveredAmount : request.totalAmount)}</strong>
          {hasDispatch && request.totalDispatchedQty !== request.totalQty && (
            <span className="muted"> (req. {request.totalQty} · {formatINR(request.totalAmount)})</span>
          )}
          <span className="muted"> · printed {formatIstDateTime(new Date())}</span>
        </span>
      </div>

      {request.notes && (
        <section className="print-notes">
          <div className="muted">Shop's notes</div>
          <div>{request.notes}</div>
        </section>
      )}

      {/* On-screen-only footer — holds the Print button. The "printed at"
          line lives inside the dense-summary strip above. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <PrintButton className="print-trigger" />
        </div>
      </footer>
    </div>
  )
}
