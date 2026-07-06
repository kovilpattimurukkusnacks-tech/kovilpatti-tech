import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { DispatchedCell } from '../../components/DispatchedCell'
import { formatINR } from '../../utils/format'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { splitBalancedColumns } from '../../utils/balancedColumns'
import { useCategories } from '../../hooks/useCategories'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

// Per-card height estimator — number of "rows" the card will occupy
// (banner + each weight header + each product). Used by splitBalancedColumns
// to pick the shorter side. Exact pixels aren't needed; relative size is.
const heightOfCatGroup = (cg: { weightGroups: { items: unknown[] }[] }) =>
  1 + cg.weightGroups.reduce((s, wg) => s + 1 + wg.items.length, 0)

// Brand block — mirrors the thermal receipt's centred header so admin/godown
// prints feel like the same product. Name stays constant; contact comes from
// the request's shopContactPhone (per-shop), falling back to em-dash.
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

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

  // Two-level grouping for the picklist: sub-category (leaf) → weight → items.
  const sections = useMemo(
    () => groupByCategoryWeight(
      request?.items ?? [],
      it => ({ category: it.categoryName, weightValue: it.weightValue, weightUnit: it.weightUnit }),
    ),
    [request],
  )

  // 30-Jun-2026 — bucket sections under their ROOT category in hard-coded
  // priority order (1 KG Snacks → Packing Items → … → Shop Needs). Each
  // root prints as its own block: an underline-style heading on top, then
  // its sub-cat banner cards flow into a 2-col grid below. Mirrors the
  // on-screen detail page hierarchy + the 3-inch thermal slip.
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
        const unitCount = children.reduce(
          (sum, sec) => sum + sec.weightGroups.reduce(
            (s, wg) => s + wg.items.reduce((a, it) => a + it.requestedQty, 0), 0), 0)
        return { root, children, productCount, unitCount }
      })
  }, [sections, categoriesQuery.data])

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
      {/* Wrap the whole sheet in a 1-column <table> so the brand + meta
          block (placed in <thead>) repeats automatically at the top of
          every printed page when the items overflow to a second / third
          sheet (30-Jun-2026 client req — header missing on page 2+).
          Browsers honour <thead>'s default display:table-header-group as
          a "repeat on page break" directive — no JS, no Paged.js needed.
          Screen view is unaffected: the table renders as one continuous
          flow with no page breaks. */}
      <table className="print-page-table">
        <thead>
          <tr>
            <td>
              {/* Centred brand header — mirrors the thermal receipt style.
                  Subtitle flips to "RETURN BILL" on Return-type requests. */}
              <header className="print-brand-header">
                <div className="print-brand-name">{BRAND_NAME}</div>
                <div className="print-brand-contact">
                  Contact: {request.shopContactPhone ?? '—'}
                </div>
                <div className="print-brand-subtitle">
                  {request.requestType === 'Return'   ? 'Return Bill'
                    : request.requestType === 'Backorder' ? 'Back-order'
                    : 'Stock Request'}
                </div>
              </header>

              {/* Two-row meta grid:
                    Row 1: Code (left) · Shop + by name (center) · Godown (right)
                    Row 2: Submitted (left) · Dispatched (right) */}
              <div className="print-meta-grid">
        <div className="print-meta-grid-row three-col">
          <div className="left">
            <span className="muted">Code: </span>
            <strong>{request.code}</strong>
            <span className="muted"> · {request.status}</span>
          </div>
          <div className="center">
            <span className="muted">Shop: </span>
            <strong>{request.shopName}</strong>
            {request.submittedByName && (
              <span className="muted"> · by {request.submittedByName}</span>
            )}
          </div>
          <div className="right">
            <span className="muted">Godown: </span>
            <strong>{request.inventoryName}</strong>
          </div>
        </div>
                <div className="print-meta-grid-row two-col">
                  <div className="left">
                    <span className="muted">Submitted: </span>
                    {formatIstDateTime(request.submittedAt)}
                  </div>
                  <div className="right">
                    {request.dispatchedAt && (
                      <>
                        <span className="muted">Dispatched: </span>
                        {formatIstDateTime(request.dispatchedAt)}
                      </>
                    )}
                  </div>
                </div>
                {/* Special Request lineage (06-Jul-2026). Prints the shop's
                    chosen label so the godown picker knows this batch is a
                    vendor-procurement — same signal as the amber SP pill
                    on the cumulative plan. */}
                {request.isSpecial && (
                  <div className="print-meta-grid-row" style={{ marginTop: 4, fontSize: 11 }}>
                    <div>
                      <span className="muted">Special Request: </span>
                      <strong>{request.specialLabel?.trim() || 'Yes'}</strong>
                    </div>
                  </div>
                )}
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
      {/* Items — grouped by ROOT category in hard-coded priority order. Each
          root block has an underline-style heading + a 2-col card flow of
          its sub-category banners. break-inside:avoid keeps a sub-category
          together; the root heading is reserved for the print layout (the
          on-screen detail page uses the fieldset/legend wrapper instead). */}
      {rootGroups.map(rg => {
        const { left, right } = splitBalancedColumns(rg.children, heightOfCatGroup)
        const renderCard = (section: typeof rg.children[number]) => {
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
              {/* 5-col dense table — # / product / req / disp / amount. */}
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
                              <td>
                                <strong>{it.productName}</strong>
                                {it.addedBy === 'Inventory' && <span style={{ marginLeft: 4, padding: '0 3px', fontSize: 8, fontWeight: 700, color: '#0277BD', border: '1px solid #0277BD', borderRadius: 2 }}>INV</span>}
                              </td>
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
        }
        return (
          <table key={rg.root} className="print-root-section">
            <thead>
              <tr><td>
                <h2 className="print-root-heading">
                  {rg.root}
                  <span className="muted">
                    · {rg.productCount} {rg.productCount === 1 ? 'product' : 'products'}
                    · {rg.unitCount} units
                  </span>
                </h2>
              </td></tr>
            </thead>
            <tbody>
              <tr><td>
                {/* A root with a single sub-cat card has nothing to balance
                    against — the 2-col flex grid would still only claim half
                    the page width. Render it full-width instead. */}
                {rg.children.length === 1 ? (
                  <div className="print-dense-col">{left.map(renderCard)}</div>
                ) : (
                  <div className="print-dense-grid">
                    <div className="print-dense-col">{left.map(renderCard)}</div>
                    <div className="print-dense-col">{right.map(renderCard)}</div>
                  </div>
                )}
              </td></tr>
            </tbody>
          </table>
        )
      })}

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
          <span className="muted"> · {rootGroups.length} {rootGroups.length === 1 ? 'category' : 'categories'} ({sections.length} sub)</span>
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

            </td>
          </tr>
        </tbody>
      </table>

      {/* On-screen-only footer — holds the Print button. The "printed at"
          line lives inside the dense-summary strip above. Sits OUTSIDE the
          repeating-header table so the button doesn't print as page chrome. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
