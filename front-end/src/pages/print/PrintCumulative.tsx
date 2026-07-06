import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCumulativePending } from '../../hooks/useStockRequests'
import { groupByCategoryWeight } from '../../utils/groupByCategoryWeight'
import { buildRootLookup, sortRootCategoryNames } from '../../utils/rootCategoryPriority'
import { splitBalancedColumnsN } from '../../utils/balancedColumns'
import { useCategories } from '../../hooks/useCategories'
import { formatIstDateTime } from '../../utils/formatDate'
import './print.css'

// 03-Jul-2026 (client req: fit the batch plan into 3-4 sheets) — a card's
// height no longer needs a "+1 per weight group" term: weight is now an
// inline column on each item row instead of its own banner row, so the
// only per-card overhead is the single category banner.
const heightOfCatGroup = (cg: { weightGroups: { items: unknown[] }[] }) =>
  1 + cg.weightGroups.reduce((s, wg) => s + wg.items.length, 0)

// Max columns per root block. 3-Jul-2026: bumped 2 → 3 (client req: fit the
// batch plan into 3-4 sheets instead of 7-8) — the dense table only needs
// # / name / weight / qty, which comfortably fits a narrower column, so a
// 3rd column is free real estate on an A4-portrait sheet.
const MAX_COLUMNS = 3

// Brand block — mirrors the thermal receipt + per-request picklist so all
// three printouts feel like the same family. Contact phone is per-shop on
// the picklist; cumulative is cross-shop so we omit it here.
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

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
      {/* 03-Jul-2026 (client req, 3rd pass) — dropped the repeating-header
          <table>/<thead> wrapper entirely. It existed to repeat the brand
          header on every printed page (30-Jun-2026 client req: "header
          missing on page 2+"), but the client has since asked for the
          OPPOSITE — brand header + meta line should print once at the top
          of page 1 only, not on every sheet. Plain divs now; nothing here
          needs table-header-group repeat semantics any more. */}
      <header className="print-brand-header">
        <div className="print-brand-name">{BRAND_NAME}</div>
        <div className="print-brand-subtitle">Cumulative Batch Plan</div>
        {/* Shop names — only when caller narrowed to specific shops.
            03-Jul-2026 client req. Comma-joined for multi-shop prints so
            the picker at the godown knows exactly which shops this batch
            covers. */}
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

      {sections.length === 0 ? (
        <p style={{ marginTop: 32 }}>No in-progress requests right now — nothing to prepare.</p>
      ) : (
        <>
          {/* Single flat 3-col grid across every root's cards (03-Jul-2026 —
              see flatCards comment above for why this replaced per-root
              page blocks). Root name rides along as a small eyebrow label
              on each card so the kitchen still knows which production line
              a card belongs to, without a heading block forcing a break. */}
          {(() => {
            const numCols = Math.min(MAX_COLUMNS, flatCards.length)
            const columns = splitBalancedColumnsN(flatCards, c => heightOfCatGroup(c.section), numCols)
            const renderCard = (card: typeof flatCards[number]) => {
              const { root, section } = card
              const skuCount    = section.weightGroups.reduce((s, wg) => s + wg.items.length, 0)
              const subtotalQty = section.weightGroups.reduce(
                (s, wg) => s + wg.items.reduce((a, r) => a + r.totalQty, 0), 0)
              // Flatten weight groups into one ordered row list — weight is
              // now an inline column per row instead of its own banner row
              // (03-Jul-2026, client req: cut the batch plan to 3-4 sheets).
              // A dedicated banner row per weight bucket was pure structural
              // overhead: ~70-90 rows across a typical catalogue that carry
              // no SKU data at all.
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
                            {/* 'pack' is the overwhelming default (see Products
                                form) — only call out the exception. */}
                            {r.type === 'jar' && <span className="print-badge">JAR</span>}
                          </td>
                          <td className="muted print-dense-weight-col">{r.weightLabel}</td>
                          {/* 06-Jul-2026 (client req): amber SP pill signals a
                              Special Request contribution on this SKU. Kitchen
                              still packs totalQty total; the pill flags whether
                              some of that came from a shop-declared Special.
                                • no SP      → just the number.
                                • all SP     → "SP" pill (pure special order).
                                • mixed      → "+N SP" pill (N = special portion). */}
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
            // 03-Jul-2026 (client req: fix the near-blank trailing page) —
            // the grand-totals strip used to be its own full-width block
            // AFTER the whole grid. If the tallest column ended too close
            // to the page boundary to fit that ~26px strip, the entire
            // strip (and nothing else) spilled onto an otherwise-empty new
            // page. Appending it inside whichever column is shortest lets
            // it fill existing leftover space instead of demanding a full
            // new row of its own.
            const colHeights = columns.map(col =>
              col.reduce((s, c) => s + heightOfCatGroup(c.section), 0))
            const shortestCol = colHeights.indexOf(Math.min(...colHeights))
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
            return (
              <div className="print-dense-grid">
                {columns.map((col, i) => (
                  <div className="print-dense-col" key={i}>
                    {col.map(renderCard)}
                    {i === shortestCol && summary}
                  </div>
                ))}
              </div>
            )
          })()}
        </>
      )}

      {/* Footer with Print button — visible on-screen only. */}
      <footer className="print-footer print-only">
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
