import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useStockRequest } from '../../hooks/useStockRequests'
import { DispatchedCell } from '../../components/DispatchedCell'
import { formatINR } from '../../utils/format'
import './print.css'

const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—'

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

  if (isLoading) return <div className="print-page"><p>Loading…</p></div>
  if (error || !request) {
    return (
      <div className="print-page">
        <p>Could not load request.</p>
      </div>
    )
  }

  const items = request.items ?? []
  const hasDispatch = request.totalDispatchedQty != null
  const isShort = hasDispatch && deliveredAmount < request.totalAmount

  return (
    <div className="print-page">
      <header className="print-header">
        <div>
          <h1 className="print-title">Stock Request — Picklist</h1>
          <div className="print-meta">
            <strong>{request.code}</strong> · {request.status}
          </div>
        </div>
        <div className="print-meta-right">
          <div><span className="muted">Requested:</span> {fmtIst(request.submittedAt)}</div>
          {request.dispatchedAt && (
            <div><span className="muted">Dispatched:</span> {fmtIst(request.dispatchedAt)}</div>
          )}
        </div>
      </header>

      <section className="print-parties">
        <div>
          <div className="muted">Shop</div>
          <div className="strong">{request.shopCode} — {request.shopName}</div>
          {request.submittedByName && (
            <div className="small">Requested by {request.submittedByName}</div>
          )}
        </div>
        <div>
          <div className="muted">Inventory</div>
          <div className="strong">{request.inventoryCode} — {request.inventoryName}</div>
          {request.dispatchedByName && (
            <div className="small">Dispatched by {request.dispatchedByName}</div>
          )}
        </div>
      </section>

      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th>Product</th>
            <th style={{ width: 80, textAlign: 'right' }}>Weight</th>
            <th style={{ width: 100, textAlign: 'right' }}>Requested</th>
            <th style={{ width: 110, textAlign: 'right' }}>Dispatched</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <td>{i + 1}</td>
              <td>
                <strong>{it.productCode}</strong> — {it.productName}
              </td>
              <td style={{ textAlign: 'right' }}>
                {it.weightValue != null ? `${it.weightValue} ${it.weightUnit ?? ''}`.trim() : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>{it.requestedQty}</td>
              <td style={{ textAlign: 'right' }}>
                <DispatchedCell qty={it.dispatchedQty} requested={it.requestedQty} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="strong" style={{ textAlign: 'right' }}>Total</td>
            <td className="strong" style={{ textAlign: 'right' }}>{request.totalQty}</td>
            <td className="strong" style={{ textAlign: 'right' }}>
              {request.totalDispatchedQty ?? '—'}
            </td>
          </tr>
        </tfoot>
      </table>

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
        <div>Printed {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
        <div className="print-only">
          <button onClick={() => window.print()} className="print-trigger">Print</button>
        </div>
      </footer>
    </div>
  )
}
