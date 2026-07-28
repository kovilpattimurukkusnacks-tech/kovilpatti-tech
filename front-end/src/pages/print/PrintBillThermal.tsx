import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useBill } from '../../hooks/useBills'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'
import './thermal.css'

/**
 * Shop-user thermal print — 3" / 80mm POS bill receipt. Mirrors the
 * stock-request thermal slip so it drops into the same shop-floor
 * workflow and printer. Data comes from the bill detail endpoint;
 * auto-fires the print dialog once the bill lands.
 */
const BRAND_NAME = 'Kovilpatti Murukku & Snacks'

export default function PrintBillThermal() {
  const { id } = useParams<{ id: string }>()
  const { data: bill, isLoading, error } = useBill(id)

  // Auto-open the print dialog ONCE. Same ref-guard as the request slip.
  const printedRef = useRef(false)
  useEffect(() => {
    if (!bill || printedRef.current) return
    printedRef.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [bill])

  if (isLoading) {
    return <div className="thermal-preview"><div className="thermal-page">Loading…</div></div>
  }
  if (error || !bill) {
    return <div className="thermal-preview"><div className="thermal-page">Could not load bill.</div></div>
  }

  return (
    <div className="thermal-preview">
      <div className="thermal-page">
        <div className="thermal-header">
          <div className="thermal-shop">{BRAND_NAME}</div>
          <div className="thermal-title">{bill.status === 'Cancelled' ? 'Bill (Cancelled)' : 'Bill'}</div>
        </div>

        <div className="thermal-rule" />

        <div className="thermal-meta">
          <span className="label">Date:</span>
          <span className="value">{formatIstDateTime(bill.createdAt)}</span>

          <span className="label">Bill:</span>
          <span className="value-strong">{bill.code}</span>

          {bill.createdByName && (
            <>
              <span className="label">By:</span>
              <span className="value">{bill.createdByName}</span>
            </>
          )}
          {bill.customerName && (
            <>
              <span className="label">Customer:</span>
              <span className="value">{bill.customerName}{bill.customerPhone ? ` (${bill.customerPhone})` : ''}</span>
            </>
          )}
        </div>

        <div className="thermal-rule" />

        <table className="thermal-items">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num" style={{ width: 30 }}>Qty</th>
              <th className="num" style={{ width: 60 }}>Price</th>
              <th className="num" style={{ width: 72 }}>Amt</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map(it => (
              <tr key={it.id}>
                <td>
                  <div className="item-name">
                    {it.productName}
                    {it.weightValue != null && (
                      <span style={{ marginLeft: 4, fontSize: 7.5, fontWeight: 700 }}>
                        {it.weightValue}{it.weightUnit ?? ''}
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{it.qty}</td>
                <td className="num">{formatINR(it.unitPrice, { prefix: false })}</td>
                <td className="num">{formatINR(it.lineTotal, { prefix: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="thermal-rule" />

        <div className="thermal-totals">
          <span>Total Items:</span>
          <span className="v">{bill.totalItems}</span>
          <span>Total Qty:</span>
          <span className="v">{bill.totalQty}</span>
        </div>

        <div className="thermal-rule-dashed" />

        <div className="thermal-grand">
          <span>Grand Total</span>
          <span>{formatINR(bill.totalAmount)}</span>
        </div>

        <div className="thermal-rule-dashed" />

        {/* Tender breakdown — one line per payment (split/credit aware). */}
        <div className="thermal-totals">
          {bill.payments.map(p => (
            <span key={p.id} style={{ display: 'contents' }}>
              <span>{p.mode}:</span>
              <span className="v">{formatINR(p.amount)}</span>
            </span>
          ))}
        </div>

        <div className="thermal-rule-dashed" />

        <div className="thermal-footer">
          <div>Printed {formatIstDateTime(new Date())}</div>
          <div className="small">{BRAND_NAME}</div>
        </div>

        <div className="thermal-actions">
          <button onClick={() => window.print()} className="thermal-print-btn">Print</button>
        </div>
      </div>
    </div>
  )
}
