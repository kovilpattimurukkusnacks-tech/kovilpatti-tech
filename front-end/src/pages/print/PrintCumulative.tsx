import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { paginateOrderedColumns } from '../../utils/balancedColumns'
import { useCategories } from '../../hooks/useCategories'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

// Max columns per page. 3-Jul-2026: bumped 2 → 3 (client req: fit the
// batch plan into 3-4 sheets instead of 7-8) — the dense table only needs
// # / name / weight / qty, which comfortably fits a narrower column, so a
// 3rd column is free real estate on an A4-portrait sheet.
const MAX_COLUMNS = 3

// ── Real-pixel page geometry (10-Jul-2026, client req) ──────────────────
// Was `splitOrderedColumnsN` — a whole-document column split that packed
// col 0 with a tall run of cards across many pages, then col 1, then col 2.
// Client report: root with 5 sub-cards would land 3-in-col-0-page-1 +
// 2-in-col-0-page-2, leaving col 1/2 of page 1 filled with a different
// root. They want left→middle→right on the SAME page first, then next
// page — i.e. page-aware pagination.
//
// Same measurement pipeline the per-request picklist uses (see that file
// for full history of why estimated row-unit heights kept drifting). Cards
// are rendered off-screen at the exact print column width, real pixel
// heights are read via getBoundingClientRect, and paginateOrderedColumns
// packs them page-by-page with true numbers.
//
// KEEP IN SYNC with @page in print.css (A4, margin 16mm 16mm 18mm 16mm).
const MM_TO_PX = 96 / 25.4
// 297mm tall minus 16mm top / 18mm bottom → 263mm ≈ 994px. 12px shaved
// as a safety buffer against sub-pixel rounding across a stacked column.
const PAGE_CONTENT_HEIGHT_PX = Math.floor((297 - 16 - 18) * MM_TO_PX) - 12
// 210mm wide minus 16mm side margins × 2, minus 2mm slack + 12mm total
// horizontal gap between three columns (2 gaps × 12mm each = 24mm) divided
// evenly to get per-column mm.
//   Column width mm = (210 − 32 − 2 − 24) / 3 = ~50.67mm each
// Both the measurement pass and the final render pin the column width to
// this exact number — text wraps identically, so measured heights hold.
const CONTENT_WIDTH_MM     = 210 - 16 - 16 - 2
const GRID_GAP_MM          = 12 * (MAX_COLUMNS - 1) / MM_TO_PX
const PRINT_COL_WIDTH_MM   = (CONTENT_WIDTH_MM - GRID_GAP_MM) / MAX_COLUMNS
// Vertical gap between cards inside a column (.print-dense-col flex gap).
const CARD_GAP = 8

// Brand block — mirrors the thermal receipt + per-request picklist so all
// three printouts feel like the same family. Contact phone is per-shop on
// the picklist; cumulative is cross-shop so we omit it here.
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

// Heights captured from the hidden measurement pass, in real CSS px.
interface MeasuredHeights {
  cards:   number[]   // one per flatCards entry, same order
  summary: number     // one-time totals strip at the bottom of the last page
  header:  number     // brand + meta block that only prints once on page 1
}

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
  // priority order (1 KG Snacks → Packing Items → … → Shop Needs).
  //
  // 03-Jul-2026 (client req: fit the batch plan into 3-4 sheets) — dropped
  // the per-root page block (heading + its own balanced 2/3-col grid).
  // Each root forced a structural break: if a root's cards didn't fully
  // fill the page, the NEXT root still started fresh rather than flowing
  // into that leftover space, so wasted tail-space compounded across every
  // root (11 roots × up to ~1/3 page each ≈ 3-4 wasted sheets). Root order
  // is preserved as a flat sequence and the root name now rides along as a
  // small label on each card instead of its own heading block, and column
  // balancing runs ONCE across the whole document — see flatCards below.
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

  // Grand totals across all categories — shown in the footer.
  // 06-Jul-2026 (client req) — also track whether ANY SKU on the plan
  // carries a Special Request portion. Used to conditionally render the
  // "SP = Special Request" legend line: shows only when the print actually
  // contains SP pills, so plans with no specials stay uncluttered.
  const { totalUnits, totalRequests, totalSkus, hasSpecial } = useMemo(() => {
    if (!rows) return { totalUnits: 0, totalRequests: 0, totalSkus: 0, hasSpecial: false }
    let units = 0
    let maxReq = 0
    let sp = false
    for (const r of rows) {
      units += r.totalQty
      if (r.requestCount > maxReq) maxReq = r.requestCount
      if (r.specialQty > 0) sp = true
    }
    return { totalUnits: units, totalRequests: maxReq, totalSkus: rows.length, hasSpecial: sp }
  }, [rows])

  // ── Measurement pass state (10-Jul-2026, client req) ─────────────────
  // Cards render into a hidden host at the exact print column width so we
  // can read real pixel heights, then pack pages against real capacity.
  // Same pattern as the per-request picklist — see PrintRequestPicklist
  // for the full history of why estimated row-unit heights kept drifting.
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState<MeasuredHeights | null>(null)

  // Reset heights when data identity changes (initial load / refetch).
  useLayoutEffect(() => { setMeasured(null) }, [flatCards])

  // After the hidden host paints, read every card + header + summary height.
  // Wait for document.fonts.ready — Plus Jakarta Sans wraps differently
  // from the fallback font, and a card whose banner wraps to 2 lines
  // under one font but not the other would corrupt the pack.
  useLayoutEffect(() => {
    if (measured || !rows) return
    let cancelled = false
    const measure = () => {
      const host = measureRef.current
      if (!host || cancelled) return
      const cardEls   = host.querySelectorAll<HTMLElement>('[data-measure="card"]')
      const headerEl  = host.querySelector<HTMLElement>('[data-measure="header"]')
      const summaryEl = host.querySelector<HTMLElement>('[data-measure="summary"]')
      // ceil, not round — a column of ~30 cards each rounded down 0.4px
      // could overflow the page by a whole row.
      setMeasured({
        cards:   Array.from(cardEls, el => Math.ceil(el.getBoundingClientRect().height)),
        header:  Math.ceil(headerEl?.getBoundingClientRect().height ?? 0),
        summary: Math.ceil(summaryEl?.getBoundingClientRect().height ?? 0),
      })
    }
    if (document.fonts?.ready) document.fonts.ready.then(measure)
    else measure()
    return () => { cancelled = true }
  }, [measured, rows, flatCards])

  if (isLoading) return <div className="print-page"><p>Loading…</p></div>
  if (error || !rows) {
    return (
      <div className="print-page">
        <p>Could not load cumulative report.</p>
      </div>
    )
  }

  // ── Extracted for reuse across measurement + real render ──────────────
  const headerBlock = (
    <>
      <header className="print-brand-header">
        <div className="print-brand-name">{BRAND_NAME}</div>
        <div className="print-brand-subtitle">Cumulative Batch Plan</div>
        {/* Shop names — only when caller narrowed to specific shops.
            Comma-joined for multi-shop prints so the picker at the godown
            knows exactly which shops this batch covers. */}
        {shopNamesParam && (
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: 2, color: '#7C4A00' }}>
            {shopNamesParam}
          </div>
        )}
      </header>

      <div className="print-meta-inline">
        <span className="muted">Generated: </span>
        {formatIstDateTime(new Date())}
        {totalRequests > 0 && (
          <>
            {' '}·{' '}
            <span className="muted">Sourced from: </span>
            up to <strong>{totalRequests}</strong> request{totalRequests === 1 ? '' : 's'}
          </>
        )}
        {hasSpecial && (
          <>
            {' '}·{' '}
            <span className="print-badge-sp">SP</span>
            <span className="muted"> = Special Request (vendor-procured) contribution</span>
          </>
        )}
      </div>
    </>
  )

  const renderCard = (card: typeof flatCards[number]) => {
    const { root, section } = card
    const skuCount    = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
    const subtotalQty = section.weightGroups.reduce(
      (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0)
    // Flatten weight groups into one ordered row list — weight is now
    // an inline column per row instead of its own banner row (03-Jul-2026,
    // client req: cut the batch plan to 3-4 sheets).
    const flatItems = section.weightGroups.flatMap(wg =>
      wg.items.map(r => ({ ...r, weightLabel: wg.label })))
    return (
      <section key={section.category} className="print-dense-section">
        <div className="print-dense-banner">
          <span className="print-dense-root-eyebrow">{root}</span>
          <span className="print-dense-banner-name">
            {section.category}
            <span className="muted">
              · {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
              · {subtotalQty.toLocaleString('en-IN')} units
            </span>
          </span>
        </div>
        <table className="print-dense-table">
          <colgroup>
            <col style={{ width: 18 }} />
            <col />
            <col style={{ width: 42 }} />
            <col style={{ width: 62 }} />
          </colgroup>
          <tbody>
            {flatItems.map((r, i) => (
              <tr
                key={`${r.productId}-${r.weightValue ?? 'x'}-${r.weightUnit ?? ''}`}
                className={r.specialQty > 0 ? 'special-row' : undefined}
              >
                <td>{i + 1}</td>
                <td>
                  <strong>{r.productName}</strong>
                  {r.type === 'jar' && <span className="print-badge">JAR</span>}
                </td>
                <td className="muted print-dense-weight-col">{r.weightLabel}</td>
                {/* 06-Jul-2026 (client req): amber SP pill signals a
                    Special Request contribution on this SKU. */}
                <td style={{ textAlign: 'right' }} className="strong">
                  {r.totalQty.toLocaleString('en-IN')}
                  {r.specialQty > 0 && (
                    <span className="print-badge-sp">
                      {r.orderQty === 0 ? 'SP' : `+${r.specialQty.toLocaleString('en-IN')} SP`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }

  const summary = (
    <div key="summary" className="print-column-summary">
      <div>
        {totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'}
        <span className="muted"> · {rootGroups.length} {rootGroups.length === 1 ? 'category' : 'categories'} ({sections.length} sub)</span>
      </div>
      <div>
        {totalUnits.toLocaleString('en-IN')} units
        {totalRequests > 0 && (
          <span className="muted">
            {' '}· from up to {totalRequests} request{totalRequests === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="muted">printed {formatIstDateTime(new Date())}</div>
    </div>
  )

  const printFooter = (
    <footer className="print-footer print-only">
      <div className="print-only">
        <button onClick={() => window.print()} className="print-trigger">Print</button>
      </div>
    </footer>
  )

  // Empty-state page — nothing to paginate.
  if (sections.length === 0) {
    return (
      <div className="print-page">
        {headerBlock}
        <p style={{ marginTop: 32 }}>No in-progress requests right now — nothing to prepare.</p>
        {printFooter}
      </div>
    )
  }

  const numCols = Math.min(MAX_COLUMNS, Math.max(1, flatCards.length))
  const colWidthStyle = { flex: '0 0 auto', width: `${PRINT_COL_WIDTH_MM}mm` } as const

  // ── Pass 1: hidden measurement render ────────────────────────────────
  // Render every card, plus copies of the header and summary strip, at
  // the exact final print widths. Off-screen + visibility:hidden (NOT
  // display:none — that would produce zero heights). After
  // useLayoutEffect reads the heights, this branch is replaced by the
  // paginated real render below.
  if (!measured) {
    return (
      <div className="print-page">
        {headerBlock}
        <div
          ref={measureRef}
          className="print-measure-host"
          style={{ width: `${CONTENT_WIDTH_MM}mm` }}
        >
          <div data-measure="header">{headerBlock}</div>
          <div style={{ width: `${PRINT_COL_WIDTH_MM}mm` }}>
            {flatCards.map(card => (
              <div data-measure="card" key={card.section.category}>
                {renderCard(card)}
              </div>
            ))}
            {/* flow-root so the summary margin is contained in the
                wrapper's measured height instead of collapsing out of it. */}
            <div data-measure="summary" style={{ display: 'flow-root' }}>
              {summary}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Pass 2: page-aware paginate with real heights ────────────────────
  // 10-Jul-2026 client req: sub-categories under one root must print
  // continuously left → middle → right on the SAME page before the next
  // page. paginateOrderedColumns fills one column at a time to full page
  // capacity, then jumps to the next column (still on the same page).
  // Only when all N columns of a page are full does it start a new page.
  const pageCap  = PAGE_CONTENT_HEIGHT_PX + CARD_GAP
  const page1Cap = pageCap - measured.header
  const indexed  = flatCards.map((card, i) => ({ card, i }))
  const pages    = paginateOrderedColumns(
    indexed,
    x => measured.cards[x.i] + CARD_GAP,
    numCols,
    pageCap,
    page1Cap,
  )
  if (pages.length === 0) pages.push(Array.from({ length: numCols }, () => []))

  // Place the grand-totals summary in whichever column of the LAST page
  // has the most room left — verified against its measured height, so it
  // can no longer overflow invisibly to a fresh sheet.
  const lastPageIdx = pages.length - 1
  const usedPx = pages[lastPageIdx].map(col =>
    col.reduce((s, x) => s + measured.cards[x.i] + CARD_GAP, 0))
  let summaryCol = usedPx.indexOf(Math.min(...usedPx))
  const lastCap = lastPageIdx === 0 ? page1Cap : pageCap
  if (usedPx[summaryCol] + measured.summary + CARD_GAP > lastCap) {
    pages.push(Array.from({ length: numCols }, () => []))
    summaryCol = 0
  }
  const summaryPage = pages.length - 1

  return (
    <div className="print-page">
      {headerBlock}
      {pages.map((columns, p) => (
        <div className="print-page-block" key={p}>
          {/* Fixed-width columns can undershoot the paper width when the
              print dialog uses smaller margins than @page — centre the
              grid so leftover width splits evenly instead of piling up
              on the right edge. */}
          <div className="print-dense-grid" style={{ justifyContent: 'center' }}>
            {columns.map((col, i) => (
              <div className="print-dense-col" style={colWidthStyle} key={i}>
                {col.map(x => renderCard(x.card))}
                {p === summaryPage && i === summaryCol && summary}
              </div>
            ))}
          </div>
        </div>
      ))}
      {printFooter}
    </div>
  )
}
