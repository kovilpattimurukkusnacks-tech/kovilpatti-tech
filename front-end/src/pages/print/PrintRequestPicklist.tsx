import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { DispatchedCell } from '../../components/DispatchedCell'
import { formatINR } from '../../utils/format'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { paginateOrderedColumns } from '../../utils/balancedColumns'
import { useCategories } from '../../hooks/useCategories'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

// Max columns per page. Mirrors the cumulative batch plan's column-balance
// fix (07-Jul-2026) — see flatCards below for why the per-root structural
// break was dropped in favour of an explicit paginated N-column pack.
const MAX_COLUMNS = 3

// ── Real-pixel page geometry (07-Jul-2026, second pass) ─────────────────
// The first pass fed paginateBalancedColumns ESTIMATED "row unit" heights
// with hand-derived capacity constants. Both calibration attempts failed in
// opposite directions (32 → packed pages half-empty; 58 → packer declared
// 2 pages, browser re-split each into ~2 sheets leaving ragged gaps where
// atomic cards got pushed down). Estimation can't win: any drift between
// the unit math and real rendered heights compounds across ~20 cards.
//
// Now the cards are rendered once into a hidden off-screen container at the
// exact print column width, measured with getBoundingClientRect, and packed
// using REAL pixel heights against the REAL page height. No constants to
// re-tune when fonts/padding change — the measurement pass just sees it.
//
// Chrome lays print out at CSS-px scale (96dpi), so mm→px is exact math.
// KEEP THESE IN SYNC with @page in print.css (A4, margin 8mm 16mm 18mm).
const MM_TO_PX = 96 / 25.4
// 297mm tall minus 8mm top / 18mm bottom margins → 271mm ≈ 1024px content
// height. 12px shaved as a safety buffer for sub-pixel rounding across a
// column of stacked cards.
const PAGE_CONTENT_HEIGHT_PX = Math.floor((297 - 8 - 18) * MM_TO_PX) - 12
// 210mm wide minus 16mm side margins, minus 2mm slack so a sub-pixel
// rounding overflow can never trigger Chrome's shrink-to-fit scaling.
// BOTH the measurement pass and the final page render pin their column
// width to this same number (inline style, not flex) — text wraps
// identically in both, so measured card heights hold exactly on paper even
// if the print dialog's margin/paper settings differ from @page. The
// name column absorbs all width changes in these tables (every other
// column is fixed), so even a few mm of width drift compounds into big
// wrap-count differences — never let the two passes disagree on width.
const PRINT_CONTENT_WIDTH_MM = 210 - 16 - 16 - 2
// Vertical gap between cards inside a column (.print-dense-col flex gap).
const CARD_GAP = 8
// Horizontal gap between columns (.print-dense-grid flex gap).
const GRID_GAP = 12

// Brand block — mirrors the thermal receipt's centred header so admin/godown
// prints feel like the same product. Name stays constant; contact comes from
// the request's shopContactPhone (per-shop), falling back to em-dash.
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

// Heights captured from the hidden measurement pass, in real CSS px.
interface MeasuredHeights {
  cards: number[]   // one per flatCards entry, same order
  header: number    // brand header + special banner + meta grid (page 1 only)
  tail: number      // totals strip + notes box (placed on the last page)
}

/**
 * Single-request picklist. Standalone route, no sidebar/header chrome,
 * auto-triggers the browser print dialog once the data lands. User can
 * "Save as PDF" from the browser print dialog.
 */
export default function PrintRequestPicklist() {
  const { id } = useParams<{ id: string }>()
  const { data: request, isLoading, error } = useStockRequest(id)

  // Real card heights from the hidden measurement render; null until the
  // webfont has loaded and the first measurement pass has run.
  const [measured, setMeasured] = useState<MeasuredHeights | null>(null)
  const measureRef = useRef<HTMLDivElement>(null)

  // Auto-open the browser print dialog ONCE when the data is ready AND the
  // measured pagination has rendered. Without this ref guard, React Query
  // data refetches (or StrictMode double-invoke in dev) can queue multiple
  // window.print() calls — which leaves "ghost" dialogs that lock both this
  // tab and its opener.
  const printedRef = useRef(false)
  useEffect(() => {
    if (!request || !measured || printedRef.current) return
    // ?noauto=1 — debugging escape hatch: keep the page interactive without
    // the print dialog stealing focus (the Print button still works).
    if (new URLSearchParams(window.location.search).has('noauto')) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [request, measured])

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
  // priority order (1 KG Snacks → Packing Items → … → Shop Needs).
  //
  // 07-Jul-2026 (mirrors the cumulative batch-plan fix) — dropped the
  // per-root heading block + its own balanced-column split. Each root
  // forced a break: if a root's cards didn't fully fill its grid, the next
  // root still started fresh instead of flowing into that leftover space,
  // wasting a fraction of a page per root. Root order is preserved as a
  // flat sequence and the root name now rides along as a small eyebrow
  // label on each card instead of its own heading block — see flatCards.
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
      .map(root => ({ root, children: byRoot.get(root)! }))
  }, [sections, categoriesQuery.data])

  // Single flat sequence of (root, section) pairs in root-priority →
  // alphabetical order — the unit the whole-document column balance
  // operates on, instead of balancing separately per root.
  const flatCards = useMemo(
    () => rootGroups.flatMap(rg => rg.children.map(section => ({ root: rg.root, section }))),
    [rootGroups],
  )

  // Data identity changed (initial load / React Query refetch) → stale
  // heights, re-measure before paginating again.
  useLayoutEffect(() => { setMeasured(null) }, [flatCards])

  // Measurement pass: once the hidden host has painted, read every card's
  // real rendered height. Waits for document.fonts.ready first — Plus
  // Jakarta Sans wraps differently from the fallback font, and a card whose
  // banner wraps to 2 lines under one font but not the other would corrupt
  // the pack.
  useLayoutEffect(() => {
    if (measured || !request) return
    let cancelled = false
    const measure = () => {
      const host = measureRef.current
      if (!host || cancelled) return
      const cardEls = host.querySelectorAll<HTMLElement>('[data-measure="card"]')
      const headerEl = host.querySelector<HTMLElement>('[data-measure="header"]')
      const tailEl = host.querySelector<HTMLElement>('[data-measure="tail"]')
      // ceil, not round — a column of ~20 cards each rounded down 0.4px
      // could overflow the page by a whole row.
      const result = {
        cards: Array.from(cardEls, el => Math.ceil(el.getBoundingClientRect().height)),
        header: Math.ceil(headerEl?.getBoundingClientRect().height ?? 0),
        tail: Math.ceil(tailEl?.getBoundingClientRect().height ?? 0),
      }
      // Debug breadcrumb for print-layout investigations (07-Jul-2026):
      // window.__picklistMeasure in DevTools shows exactly what the packer
      // was told, incl. the width the cards were measured at.
      ;(window as unknown as Record<string, unknown>).__picklistMeasure = {
        ...result,
        hostWidth: host.getBoundingClientRect().width,
        colWidth: (cardEls[0]?.parentElement as HTMLElement | null)?.getBoundingClientRect().width,
        pageContentHeightPx: PAGE_CONTENT_HEIGHT_PX,
      }
      setMeasured(result)
    }
    if (document.fonts?.ready) document.fonts.ready.then(measure)
    else measure()
    return () => { cancelled = true }
  }, [measured, request, flatCards])

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

  // 07-Jul-2026 (mirrors the cumulative batch-plan fix, client req) —
  // dropped the repeating-header <table>/<thead> wrapper. It existed to
  // repeat the brand header on every printed page (30-Jun-2026 client req:
  // "header missing on page 2+"), but with the flat N-column grid below now
  // landing 250-item requests in far fewer pages, the client asked for the
  // header to print once at the top of page 1 only — same as the cumulative
  // report. Plain divs now; nothing here needs table-header-group repeat
  // semantics any more. Built as a variable because the measurement pass
  // renders a second hidden copy at print width to learn its real height.
  const headerBlock = (
    <>
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

      {/* Big amber SPECIAL REQUEST banner (06-Jul-2026, client req):
          the picker at the godown needs to know at first glance that
          this batch is a vendor-procured special, not stock they can
          pack from on-hand. Solid fill + print-color-adjust:exact so
          it survives grayscale printing legibly. */}
      {request.isSpecial && (
        <div className="print-special-banner">
          <span className="print-special-banner-badge">SPECIAL REQUEST</span>
          {request.specialLabel?.trim() && (
            <span className="print-special-banner-label">
              {request.specialLabel.trim()}
            </span>
          )}
          <span className="print-special-banner-sub">
            Procure from vendor · do not pack from stock
          </span>
        </div>
      )}

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
      </div>
    </>
  )

  const renderCard = (card: typeof flatCards[number]) => {
    const { root, section } = card
    const sectionQty = section.weightGroups.reduce(
      (s, wg) => s + wg.items.reduce((a, it) => a + it.requestedQty, 0), 0)
    const productCount = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
    return (
      <section key={section.category} className="print-dense-section">
        <div className="print-dense-banner">
          <span className="print-dense-root-eyebrow">{root}</span>
          <span className="print-dense-banner-name">
            {section.category}
            <span className="muted">
              · {productCount} {productCount === 1 ? 'product' : 'products'}
              · {sectionQty} units
            </span>
          </span>
        </div>
        {/* Dense table — # / product / weight / req / [disp] / amount.
            Weight is an inline column per row instead of its own banner
            row per weight-group (07-Jul-2026, mirrors the cumulative
            batch-plan fix). The dispatched column only exists once the
            request actually HAS dispatch data — before that it printed
            "—" on every row while eating ~44px that the product-name
            column desperately needs at 3-column width (the fixed columns
            + padding alone exceed a third of the printable width, so
            every px given up here goes straight to fewer name wraps →
            visibly shorter cards → fewer pages). */}
        {/* 08-Jul-2026 (client req: amount on the RIGHT side, back as a
            column). To make it fit in the 3-column card layout without
            overlap: drop decimals (kitchen doesn't need paise) and pin
            nowrap. "1,050" instead of "1,050.00" is ~40% narrower — fits
            in a 46px column, leaving ~64px for the name. */}
        <table className="print-dense-table">
          <colgroup>
            <col style={{ width: 18 }} />
            <col />
            <col style={{ width: 34 }} />
            <col style={{ width: 28 }} />
            {hasDispatch && <col style={{ width: 34 }} />}
            <col style={{ width: 46 }} />
          </colgroup>
          <tbody>
            {section.weightGroups.flatMap(wg => wg.items.map(it => ({ ...it, weightLabel: wg.label }))).map((it, idx) => {
              const effQty = it.dispatchedQty ?? it.requestedQty
              const lineAmt = effQty * it.unitPrice
              // Drop decimals — Math.round because .5 halves round to nearest
              // whole rupee, which matches how the kitchen counts on paper.
              const lineAmtWhole = Math.round(lineAmt).toLocaleString('en-IN')
              return (
                <tr key={it.id}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{it.productName}</strong>
                    {it.addedBy === 'Inventory' && <span style={{ marginLeft: 4, padding: '0 3px', fontSize: 8, fontWeight: 700, color: '#0277BD', border: '1px solid #0277BD', borderRadius: 2 }}>INV</span>}
                  </td>
                  <td className="muted print-dense-weight-col">{it.weightLabel}</td>
                  <td style={{ textAlign: 'right' }}>{it.requestedQty}</td>
                  {hasDispatch && (
                    <td style={{ textAlign: 'right' }}>
                      <DispatchedCell qty={it.dispatchedQty} requested={it.requestedQty} />
                    </td>
                  )}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className="strong">
                    {lineAmtWhole}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    )
  }

  // Totals strip + notes box — appended inside a column on the LAST page
  // instead of as a trailing full-width block, so they fill existing
  // leftover space rather than spilling onto an otherwise-empty new page.
  const summary = (
    <div key="summary" className="print-column-summary">
      <div>
        {hasDispatch ? 'Dispatched' : 'Requested'}
        <span className="muted"> · </span>
        <strong>{hasDispatch ? request.totalDispatchedQty : request.totalQty}</strong> units
        <span className="muted"> · {rootGroups.length} {rootGroups.length === 1 ? 'category' : 'categories'} ({sections.length} sub)</span>
      </div>
      <div className={isShort ? 'danger' : ''}>
        <strong>{formatINR(hasDispatch ? deliveredAmount : request.totalAmount)}</strong>
        {hasDispatch && request.totalDispatchedQty !== request.totalQty && (
          <span className="muted"> (req. {request.totalQty} · {formatINR(request.totalAmount)})</span>
        )}
      </div>
      <div className="muted">printed {formatIstDateTime(new Date())}</div>
    </div>
  )
  // 07-Jul-2026 — the shop's notes box used to render as its own full-width
  // block AFTER every page-block, outside the paginator's capacity budget
  // entirely. When the last page was packed right up to its limit, that
  // small box had nowhere left to go and spilled onto an otherwise-blank
  // extra page by itself. It travels with the summary now.
  const notesBlock = request.notes && (
    <div key="notes" className="print-notes">
      <div className="muted">Shop's notes</div>
      <div>{request.notes}</div>
    </div>
  )

  const numCols = Math.min(MAX_COLUMNS, Math.max(1, flatCards.length))
  const colWidth = `calc((${PRINT_CONTENT_WIDTH_MM}mm - ${(numCols - 1) * GRID_GAP}px) / ${numCols})`

  // ── Pass 1: hidden measurement render ──────────────────────────────────
  // Every card at the exact print column width, plus a copy of the header
  // and the summary/notes tail. Off-screen + visibility:hidden (NOT
  // display:none — that would produce zero heights). Once useLayoutEffect
  // reads the heights, this whole branch is replaced by the real pages.
  if (!measured) {
    return (
      <div className="print-page">
        {headerBlock}
        <div
          ref={measureRef}
          className="print-measure-host"
          style={{ width: `${PRINT_CONTENT_WIDTH_MM}mm` }}
        >
          <div data-measure="header">{headerBlock}</div>
          <div style={{ width: colWidth }}>
            {flatCards.map(card => (
              <div data-measure="card" key={card.section.category}>
                {renderCard(card)}
              </div>
            ))}
            {/* flow-root so the summary/notes margins are contained in the
                wrapper's measured height instead of collapsing out of it */}
            <div data-measure="tail" style={{ display: 'flow-root' }}>
              {summary}
              {notesBlock}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Pass 2: paginate with real heights ──────────────────────────────────
  // Each card carries its measured height + CARD_GAP (a column of n cards
  // has n-1 flex gaps, so the capacity gets one CARD_GAP added back to
  // compensate for the overcount).
  const pageCap = PAGE_CONTENT_HEIGHT_PX + CARD_GAP
  const page1Cap = pageCap - measured.header
  const indexed = flatCards.map((card, i) => ({ card, i }))
  // 07-Jul-2026 (client req) — was paginateBalancedColumns, whose first-fit
  // backfill let a smaller later card jump ahead of a larger earlier one.
  // Strict category order down each column now; reading order wins over
  // page count.
  const pages = paginateOrderedColumns(
    indexed, x => measured.cards[x.i] + CARD_GAP, numCols, pageCap, page1Cap,
  )
  if (pages.length === 0) pages.push(Array.from({ length: numCols }, () => []))

  // Place the summary/notes tail in whichever column of the last page has
  // the most room left — verified against its MEASURED height, so it can
  // no longer overflow invisibly. Only if it genuinely doesn't fit anywhere
  // does it get a fresh page.
  const lastPageIdx = pages.length - 1
  const usedPx = pages[lastPageIdx].map(col =>
    col.reduce((s, x) => s + measured.cards[x.i] + CARD_GAP, 0))
  let tailCol = usedPx.indexOf(Math.min(...usedPx))
  const lastCap = lastPageIdx === 0 ? page1Cap : pageCap
  // + 2×CARD_GAP: the tail was measured in block flow, but in the column it
  // sits behind up to two extra flex gaps (before summary, before notes).
  if (usedPx[tailCol] + measured.tail + 2 * CARD_GAP > lastCap) {
    pages.push(Array.from({ length: numCols }, () => []))
    tailCol = 0
  }
  const tailPage = pages.length - 1

  return (
    <div className="print-page">
      {headerBlock}
      {pages.map((columns, p) => (
        <div className="print-page-block" key={p}>
          {/* Fixed-width columns can undershoot the paper width when the
              print dialog uses smaller margins than @page — centre the
              grid so leftover width splits evenly instead of piling up on
              the right edge. */}
          <div className="print-dense-grid" style={{ justifyContent: 'center' }}>
            {columns.map((col, i) => (
              /* Width pinned to the exact measurement-pass width (overrides
                 the class's flex:1 1 0) — see PRINT_CONTENT_WIDTH_MM. */
              <div className="print-dense-col" style={{ flex: '0 0 auto', width: colWidth }} key={i}>
                {col.map(x => renderCard(x.card))}
                {p === tailPage && i === tailCol && summary}
                {p === tailPage && i === tailCol && notesBlock}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* On-screen-only footer — holds the Print button. The "printed at"
          line lives inside the dense-summary strip above. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
