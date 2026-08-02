import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { useCategories } from '../../hooks/useCategories'
import { packSizeInGrams } from '../../utils/formatDispatched'
import './thermal.css'

// See PrintRequestPicklist for the full comment — same rule here: use the
// effective dispatch (actual → draft → requested-fallback), and count
// partial-weight lines by fractional pack count.
type ThermalLine = {
  dispatchedQty: number | null
  dispatchedWeightG: number | null
  draftDispatchedQty: number | null
  draftDispatchedWeightG: number | null
  weightValue: number | null
  weightUnit: string | null
}
function effectiveDispatchPacks(it: ThermalLine): number | null {
  if (it.dispatchedQty != null) return it.dispatchedQty
  if (it.dispatchedWeightG != null) {
    const pack = packSizeInGrams(it.weightValue, it.weightUnit)
    if (pack) return it.dispatchedWeightG / pack
  }
  if (it.draftDispatchedQty != null) return it.draftDispatchedQty
  if (it.draftDispatchedWeightG != null) {
    const pack = packSizeInGrams(it.weightValue, it.weightUnit)
    if (pack) return it.draftDispatchedWeightG / pack
  }
  return null
}

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

  // Effective dispatch amount = Σ (effective packs × MRP). Effective packs
  // = finalised dispatch → draft → requested (untouched fallback). Mirrors
  // the A4 picklist's rule so both printouts land the same total.
  const deliveredAmount = useMemo(() => {
    if (!request) return 0
    return (request.items ?? []).reduce(
      (sum, it) => {
        const packs = effectiveDispatchPacks(it) ?? it.requestedQty
        return sum + packs * it.unitPrice
      },
      0,
    )
  }, [request])

  // Two-level grouping — sub-category (leaf) → weight → items.
  const sections = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request],
  )

  // 30-Jun-2026 — also bucket sections under their ROOT category and order
  // by the hard-coded priority list (1 KG Snacks → Packing Items → … →
  // Shop Needs). Mirrors the on-screen detail page hierarchy so the printed
  // slip walks the picker through the categories in the same physical order
  // the godown stores them.
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
        const productCount = children.reduce(
          (sum, sec) => sum + sec.weightGroups.reduce((s, wg) => s + wg.items.length, 0),
          0,
        )
        return { root, children, productCount }
      })
  }, [sections, categoriesQuery.data])

  if (isLoading) {
    return <div className="thermal-preview"><div className="thermal-page">Loading…</div></div>
  }
  if (error || !request) {
    return <div className="thermal-preview"><div className="thermal-page">Could not load request.</div></div>
  }

  // 01-Aug-2026 — grand total = effective dispatch amount (sum of line
  // amounts), so the receipt total always matches what's printed above.
  // qtyShown mirrors the same rule via deliveredQty computed off the
  // effective packs; otherwise pre-dispatch printouts would show a total
  // qty (from request.totalQty) that disagrees with the individual line
  // Disp column.
  const hasDispatch = request.status === 'Dispatched' || request.status === 'Received' || request.status === 'Accepted'
  const grandTotal  = deliveredAmount
  const deliveredQty = (request.items ?? []).reduce(
    (sum, it) => sum + (effectiveDispatchPacks(it) ?? it.requestedQty),
    0,
  )
  const qtyShown    = Math.round(deliveredQty)

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
            {request.requestType === 'Return'   ? 'Return Bill'
              : request.requestType === 'Backorder' ? 'Back-order'
              : 'Stock Request'}
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
          {/* Special Request marker on the thermal slip (06-Jul-2026). */}
          {request.isSpecial && (
            <>
              <span className="label">Special:</span>
              <span className="value">{request.specialLabel?.trim() || 'Yes'}</span>
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
            {/* Qty column widened to fit "req/disp" pair (e.g. "11/10").
                Client req 01-Aug-2026: show both requested + dispatched
                on every printout regardless of state, so the drop is
                visible per line. */}
            <tr>
              <th>Item</th>
              <th className="num" style={{ width: 50 }}>Req/Disp</th>
              <th className="num" style={{ width: 60 }}>Price</th>
              <th className="num" style={{ width: 72 }}>Amt</th>
            </tr>
          </thead>
          <tbody>
            {rootGroups.map(rg => (
              <Fragment key={rg.root}>
                {/* Root heading — outlined bar (heavy top + bottom rule).
                    Distinct from the sub-cat band below (solid black) so
                    the picker sees the hierarchy at a glance even on a
                    low-res thermal print. */}
                <tr className="root-row">
                  <td colSpan={4}>
                    {rg.root}
                    <span className="root-count">
                      · {rg.productCount} {rg.productCount === 1 ? 'product' : 'products'}
                    </span>
                  </td>
                </tr>
                {rg.children.map(section => (
                  <Fragment key={`${rg.root}__${section.category}`}>
                    {/* Sub-category band — solid black, white text. */}
                    <tr className="cat-row">
                      <td colSpan={4}>{section.category}</td>
                    </tr>
                    {/* Weight strips — one per pack-weight bucket. Weight
                        appears here so the per-item sub-line is dropped to
                        avoid duplicating the same info. */}
                    {section.weightGroups.map(wg => (
                      <Fragment key={`${rg.root}__${section.category}__${wg.label}`}>
                        <tr className="weight-row">
                          <td colSpan={4}>
                            {wg.label}
                            <span className="weight-count">
                              · {wg.items.length} {wg.items.length === 1 ? 'product' : 'products'}
                            </span>
                          </td>
                        </tr>
                        {wg.items.map(it => {
                          // Effective dispatch packs — actual → draft →
                          // null (untouched). Amount uses effQty (draft
                          // or actual); untouched line falls back to
                          // requestedQty for the kitchen's default plan.
                          const dispPacks = effectiveDispatchPacks(it)
                          const effQty    = dispPacks ?? it.requestedQty
                          const amt       = effQty * it.unitPrice
                          // Display: "req/disp" — if disp is null we show
                          // "1/—"; if disp is fractional (partial weight)
                          // trim to 2 decimals so "10.75" fits the 50px
                          // column without wrap.
                          const dispStr = dispPacks == null
                            ? '—'
                            : Number.isInteger(dispPacks) ? String(dispPacks) : dispPacks.toFixed(2)
                          return (
                            <tr key={it.id}>
                              <td>
                                <div className="item-name">
                                  {it.productName}
                                  {it.addedBy === 'Inventory' && <span style={{ marginLeft: 4, fontSize: 7.5, fontWeight: 700, letterSpacing: 0.3 }}>(INV)</span>}
                                </div>
                              </td>
                              <td className="num">{it.requestedQty}/{dispStr}</td>
                              {/* Indian comma grouping (1,200.00 / 1,23,456.00)
                                  via formatINR — prefix:false drops the ₹
                                  since the column header already labels the
                                  unit. */}
                              <td className="num">{formatINR(it.unitPrice, { prefix: false })}</td>
                              <td className="num">{formatINR(amt,          { prefix: false })}</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
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

          {/* Always show requested when it differs from the effective dispatched
              total (draft OR actual). Client can then see the gap regardless
              of whether the request has been finalised or not. */}
          {qtyShown !== request.totalQty && (
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
