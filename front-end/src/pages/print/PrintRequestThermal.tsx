import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import './thermal.css'

/**
 * Shop-user thermal print — 3" / 80mm receipt layout. Mirrors the
 * physical receipt the shop staff already produce on their existing
 * thermal printer, so the printed picklist slips into the same
 * shop-floor workflow.
 *
 * Brand NAME is the parent business — same across every shop, so it
 * stays a constant. The CONTACT phone IS shop-specific and comes from
 * the request's shopContactPhone (shops.contact_phone_1). Falls back
 * to a placeholder if a legacy request comes back without the field.
 */
const BRAND_NAME             = 'Kovilpatti Murukku & Snacks'
const BRAND_CONTACT_FALLBACK = '—'

export default function PrintRequestThermal() {
  const { id } = useParams<{ id: string }>()
  const { data: request, isLoading, error } = useStockRequest(id)

  // Auto-open browser print dialog ONCE when data lands. Same ref-guard
  // as the A4 picklist — React Query refetches / StrictMode double-render
  // would otherwise queue ghost print dialogs.
  const printedRef = useRef(false)
  useEffect(() => {
    if (!request || printedRef.current) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [request])

  // Same effective-qty rule as the A4 picklist: post-dispatch shows what
  // was actually delivered, pre-dispatch shows what the shop asked for.
  const deliveredAmount = useMemo(() => {
    if (!request) return 0
    return (request.items ?? []).reduce(
      (sum, it) => sum + (it.dispatchedQty ?? it.requestedQty) * it.unitPrice,
      0,
    )
  }, [request])

  // Two-level grouping — category → weight → items. Same shape as the
  // A4 picklist; we render it more densely below to fit 72mm.
  const sections = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request],
  )

  if (isLoading) {
    return <div className="thermal-preview"><div className="thermal-page">Loading…</div></div>
  }
  if (error || !request) {
    return <div className="thermal-preview"><div className="thermal-page">Could not load request.</div></div>
  }

  const hasDispatch = request.totalDispatchedQty != null
  const grandTotal  = hasDispatch ? deliveredAmount : request.totalAmount
  const qtyShown    = hasDispatch ? request.totalDispatchedQty : request.totalQty

  return (
    <div className="thermal-preview">
      <div className="thermal-page">
        {/* Centered brand + per-shop contact + title. Title flips to
            "RETURN BILL" on Return-type requests so the slip is visually
            distinct from a forward Order at a glance. */}
        <div className="thermal-header">
          <div className="thermal-shop">{BRAND_NAME}</div>
          <div className="thermal-contact">
            Contact: {request.shopContactPhone ?? BRAND_CONTACT_FALLBACK}
          </div>
          <div className="thermal-title">
            {request.requestType === 'Return' ? 'Return Bill' : 'Stock Request'}
          </div>
        </div>

        <div className="thermal-rule" />

        {/* Date / Code / Shop / Status / Inventory. Label-value pairs in
            a 2-column grid so the right column always lines up flush. */}
        <div className="thermal-meta">
          <span className="label">Date:</span>
          <span className="value">{formatIstDateTime(request.submittedAt)}</span>

          <span className="label">Code:</span>
          <span className="value-strong">{request.code}</span>

          <span className="label">Status:</span>
          <span className="value">{request.status}</span>

          {/* Shop + Godown show the NAME only — code is operational metadata
              the shop staff don't recognise on a printed slip. */}
          <span className="label">Shop:</span>
          <span className="value">{request.shopName}</span>

          <span className="label">Godown:</span>
          <span className="value">{request.inventoryName}</span>

          {request.submittedByName && (
            <>
              <span className="label">By:</span>
              <span className="value">{request.submittedByName}</span>
            </>
          )}
        </div>

        <div className="thermal-rule" />

        {/* Items — category header rows separate sections so the printed
            sheet stays organised on the shop floor. Inside each section,
            weight is appended to the product name (no extra row) to save
            vertical space on the strip. */}
        <table className="thermal-items">
          <thead>
            {/* Numeric column widths sized for ~6-char values ("12345.67")
                with the 2mm cell padding-left from thermal.css factored in.
                Item column flexes to the remainder of the 72mm strip. */}
            <tr>
              <th>Item</th>
              <th className="num" style={{ width: 30 }}>Qty</th>
              <th className="num" style={{ width: 60 }}>Price</th>
              <th className="num" style={{ width: 72 }}>Amt</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              <Fragment key={section.category}>
                {/* Outer dark box — the (sub-)category heading. */}
                <tr className="cat-row">
                  <td colSpan={4}>{section.category}</td>
                </tr>
                {/* Inner weight strips — one per pack-weight bucket, each
                    followed by its items. Mirrors the new-request screen's
                    two-layer hierarchy. Weight already appears on this row,
                    so we drop the per-item weight sub-line below to avoid
                    the same info showing twice. */}
                {section.weightGroups.map(wg => (
                  <Fragment key={`${section.category}__${wg.label}`}>
                    <tr className="weight-row">
                      <td colSpan={4}>
                        {wg.label}
                        <span className="weight-count">
                          · {wg.items.length} {wg.items.length === 1 ? 'product' : 'products'}
                        </span>
                      </td>
                    </tr>
                    {wg.items.map(it => {
                      const qty = it.dispatchedQty ?? it.requestedQty
                      const amt = qty * it.unitPrice
                      return (
                        <tr key={it.id}>
                          <td>
                            <div className="item-name">{it.productName}</div>
                          </td>
                          <td className="num">{qty}</td>
                          {/* Indian comma grouping (1,200.00 / 1,23,456.00) via
                              formatINR — prefix:false drops the ₹ since the
                              column header already labels the unit. */}
                          <td className="num">{formatINR(it.unitPrice, { prefix: false })}</td>
                          <td className="num">{formatINR(amt,          { prefix: false })}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>

        <div className="thermal-rule" />

        {/* Totals strip — items count + qty + (only post-dispatch)
            dispatched qty. Matches the photo's "Total Items / Total Qty"
            row pair. */}
        <div className="thermal-totals">
          <span>Total Items:</span>
          <span className="v">{request.totalItems}</span>

          <span>Total Qty:</span>
          <span className="v">{qtyShown}</span>

          {hasDispatch && qtyShown !== request.totalQty && (
            <>
              <span>Requested Qty:</span>
              <span className="v">{request.totalQty}</span>
            </>
          )}
        </div>

        <div className="thermal-rule-dashed" />

        <div className="thermal-grand">
          <span>Grand Total</span>
          <span>{formatINR(grandTotal)}</span>
        </div>

        <div className="thermal-rule-dashed" />

        {request.notes && (
          <>
            <div className="thermal-meta" style={{ gridTemplateColumns: '1fr' }}>
              <span className="label">Notes:</span>
              <span style={{ fontSize: '9.5pt' }}>{request.notes}</span>
            </div>
            <div className="thermal-rule-dashed" />
          </>
        )}

        <div className="thermal-footer">
          <div>Printed {formatIstDateTime(new Date())}</div>
          <div className="small">{BRAND_NAME}</div>
        </div>

        <div className="thermal-actions">
          <button onClick={() => window.print()} className="thermal-print-btn">
            Print
          </button>
        </div>
      </div>
    </div>
  )
}
