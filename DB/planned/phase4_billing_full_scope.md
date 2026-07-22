# Phase 4 — Billing Full Scope (planned)

**Status:** planned. Extends the current billing v1 (issue + cancel, Cash/UPI,
3" thermal print). Roadmap discussion 21-Jul-2026.

**Scope goal:** production-grade retail POS for Tamil Nadu shops — snacks
retail context (Kovilpatti-scale). Cover every daily-usage scenario a
kirana / snacks shop actually needs.

**Hardware assumed:** barcode scanner + **3" thermal printer only**
(client explicitly rejects A4 GST invoices, WhatsApp receipts, SMS
receipts — the shop uses a single thermal-printed receipt for everything).

---

## Current state (v1, shipped 14-Jul-2026)

- Issue Bill (Cash / UPI, MRP pricing, atomic stock decrement)
- Cancel Bill (same-day void, atomic stock refund)
- Recent Bills toggle + bill-detail dialog on click
- Barcode scan → auto-add to bill
- Product search + tile picker
- Payment mode: Cash | UPI (radio pair)
- 3" thermal receipt on save
- Shop-inventory linkage (fn_shop_inventory_sale / fn_shop_inventory_refund)

**Gap for TN retail:** no returns, no udhaar (credit tracking),
no split-payment, no weight-based products, no phone-lookup customers,
no discounts, no day-end reports.

---

## Tier 1 — Core (must-have, TN table-stakes)

### 1. Return Bill
- Customer brings items back for refund
- Full return (whole bill) OR partial return (some items only)
- Refund modes: Cash back, UPI reverse, add to udhaar balance, store credit
- Reason field (damaged / wrong item / changed mind / other)
- Atomic stock refund (increments shop_inventory)
- Prints a "Return Receipt" on 3" thermal — bill code + returned items + refund amount + mode
- Link to original bill (source_bill_id) for accounts trace
- **DB:** new tables `bill_returns` + `bill_return_items`, SP `fn_bill_return_create`
- **BE:** `POST /api/bills/returns` — accepts { sourceBillId, items, refundMode, reason }

### 2. Cancel Bill (improve existing)
- Same-day cancel already works. Add:
  - Manager PIN gate (configurable threshold, e.g. ₹500+ or cash bills)
  - Reason capture (mistake / duplicate / customer refused / other)
  - Prints a small "Cancel slip" on thermal (bill code + "CANCELLED" + reason + timestamp)
- **DB:** add `cancel_reason`, `cancelled_by` (audit user), `cancel_pin_used` cols to `bills`
- **BE:** extend `fn_bill_cancel` signature

### 3. Suspend / Hold Bill
- Cashier pauses mid-transaction (customer went to fetch another item)
- Bill saved with status='Held', doesn't consume stock yet
- Held bills drawer at top-right of POS — tap to resume
- Auto-expire after N hours (config, default 4h) → auto-abandon
- **DB:** new status 'Held' on `bills`, new SP `fn_bill_hold` / `fn_bill_resume`
- **UX:** floating "3 bills held" chip on POS; tap → drawer with resume/discard buttons

### 4. Udhaar / Credit Sales
- Customer buys on credit, pays later
- Requires customer identity (phone + name)
- Per-customer running balance on `customers.udhaar_balance`
- Bill's payment_mode='Credit' adds to balance; separate "Settle Udhaar"
  screen where cashier enters amount received against a customer's balance
- Prints a small "Udhaar slip" on thermal — customer name + amount added + new balance
- Cannot exceed a per-customer credit limit (configurable, default ₹5000)
- **DB:** new `customers` table, new `customer_udhaar_ledger` (each credit +
  each settlement is a ledger row), SPs `fn_customer_udhaar_add` /
  `fn_customer_udhaar_settle`
- **UX:** phone-lookup search in POS header; if not found, quick-add form
  (name + phone, 30-sec)

### 5. Split Payment
- ₹200 cash + ₹300 UPI on one bill
- Multiple tender lines per bill
- Payment mode dropdown becomes multi-add (Cash / UPI / Credit)
- Sum of tenders must equal bill total (validation)
- Change amount when cash > (total − other tenders)
- **DB:** new `bill_payments` table (bill_id, mode, amount) — remove
  the single payment_mode + payment_amount from `bills` header (migrate
  existing rows to a single-payment row in bill_payments)
- **UX:** payment strip becomes chip-based ("+ Add payment" button)

### 6. Customer Identification (base for #4)
- Phone-number lookup at POS header
- Autofill name + udhaar balance if customer exists
- Walk-in stays default (no customer attached)
- Customer purchase history — small "Last 5 bills" strip when a customer
  is selected on the POS
- **DB:** `customers` table (see #4)
- **BE:** `GET /api/customers/lookup?phone=X`, `POST /api/customers`

---

## Tier 2 — Retail Essentials (client will ask within 3 months)

### 7. Product Tile Grid + Categories
- Redesign POS layout to tile grid (Option A from earlier discussion)
- Category tabs at top → filter product tiles
- Barcode scan still works alongside tiles
- Big MRP on every tile, out-of-stock greyed out
- Recently sold products as a quick-access strip

### 8. Discounts
- Line-item discount (₹ or %)
- Bill-level discount (₹ or %)
- Manager PIN gate for discounts > threshold (e.g. > 20%)
- Discount reason capture (loyal customer / damage / manager offer / other)
- Discount total appears as a separate line on the receipt
- **DB:** add `discount_amount` + `discount_reason` on `bills` header;
  `line_discount_amount` on `bill_items`; `discount_pin_used` bool
- **UX:** on line row, small "%" icon → mini dialog for line discount;
  bill-total row has a "Discount" button below

### 9. Weight-based Products (snacks!)
- Bulk snacks sold by weight, not pieces
- Product flagged `is_weight_based` (true when weightUnit='g' or 'kg')
- Cashier enters weight (grams) → auto-calculates price at MRP/pack-weight
- On-hand stored in grams for these products
- Future: USB weighing scale integration (types weight directly into the field)
- **DB:** `products.is_weight_based` bool (derive from weightUnit); billing
  adds a weight input dialog when adding a weight-based product
- **UX:** tile has a scale icon; tap opens grams keypad

### 10. Bill History / Lookup (extend existing)
- Current "Recent Bills" toggle stays
- Add filters: date range, payment mode, cashier, customer phone
- Search by bill code (already have) + phone number (new)
- Per-row actions: Reprint / Cancel / Return
- Cannot cancel bills > 24h old (config)
- **UX:** filter chips like Stock Requests page — "Today" default, plus
  Yesterday / Last 7 days / This month / Custom

### 11. Reprint Bill
- From bill history, one-tap reprint
- Prints original receipt exactly (same layout)
- Log reprint (audit) — who reprinted, when
- **DB:** `bill_reprint_log` table (bill_id, user_id, reprinted_at)

---

## Tier 3 — Compliance & Cash Management

### 12. GST Breakdown (thermal receipt)
- Every product has HSN code
- Bill receipt shows CGST + SGST split (currently only shows total)
- Only relevant for GST-registered products (many snacks are GST-exempt)
- Tax-inclusive pricing (MRP includes GST) — display breakdown at receipt
  footer
- **DB:** `products.hsn_code`, `products.gst_rate`; SP updates for bill
  totals to compute CGST/SGST
- **Note:** no separate A4 invoice per client's decision. Thermal receipt
  is the ONLY receipt.

### 13. Day-End / Shift Close
- **Opening cash** — cashier logs starting cash at shift start
- **Petty cash entries** — small outgoing expenses (tea, snacks, staff pay)
  paid from till during the day; deducted from expected cash
- **Closing cash count** — physical count at day end; system shows
  expected vs actual; variance recorded
- **Z-report** — day-end summary (thermal print): total sales, cash /
  UPI / credit breakdown, bill count, refunds, cancellations, petty cash,
  expected vs actual cash
- **End-of-day close** — locks previous day's bills from cancel/edit
  (return still allowed for X days)
- **DB:** `shift_sessions` table (shop_id, user_id, opened_at, closed_at,
  opening_cash, closing_cash, variance); `petty_cash_entries` table
- **UX:** "Open Shift" prompt on first login of the day; "Close Shift"
  button top-right when a shift is active

### 14. Cashier / User Session per Bill
- Each bill records `issued_by_user_id` (which cashier)
- Cashier-wise sales report
- Handover between shifts (Close shift → Open shift on same till)
- **DB:** `bills.issued_by_user_id` (already stored via BE auth); expose
  in the list + report queries

---

## Tier 4 — Reports & Analytics

### 15. Sales Reports
- Daily sales (grand total + payment breakdown)
- Weekly / Monthly rollups
- Product-wise sales (top-selling, slow movers)
- Payment mode split trend
- Peak-hours heatmap (busiest hour of day)
- Cashier-wise sales
- **BE:** new SPs `fn_billing_sales_summary`, `fn_billing_top_products`,
  `fn_billing_hourly_heatmap`
- **UX:** new admin page `/admin/billing-reports` with date-range +
  chart cards (reuse dashboard chart components)

### 16. Slow-moving Products / Dead Stock
- Products with zero sales in last N days highlighted
- Product-detail page shows "Last sold: X days ago"
- Helps godown/shop clear out dead stock via discount
- **BE:** query on `bill_items` grouped by product_id + max issued_at

### 17. Customer Analytics
- Top customers by ₹ spent
- Average bill value per customer
- Customer frequency (visits/month)
- Birthday / anniversary lookup for auto-offers
- **DB:** derived queries; no new tables

---

## Tier 5 — Nice-to-have (later)

### 18. Loyalty Points
- Points per ₹ spent (e.g. 1 point per ₹100)
- Redeem points for discount (₹1 per 10 points)
- Points balance on customer profile
- Auto-expire after 12 months
- **DB:** `customer_points_ledger` (each earn / redeem is a ledger row)

### 19. Coupon Codes
- Generate coupon codes (fixed amount / percent)
- Expiry date, single-use / multi-use
- Redeem at billing (input coupon code → discount applied)
- Track redemption history
- **DB:** `coupons` + `coupon_redemptions` tables

### 20. Exchange Bill
- Return + purchase in one transaction
- Return credit auto-applied to new bill total
- Cashier settles only the difference (cash / UPI / udhaar)
- Prints one receipt showing both sides
- Depends on: Return Bill (#1)

### 21. Employee Purchases / Staff Discount
- Employees buy products at staff discount rate
- Configurable staff discount % per role
- Tracked separately in reports (staff vs customer sales)
- **DB:** `users.staff_discount_pct` col; SP validates + applies at billing

### 22. Multi-till (advanced)
- Multiple counters running simultaneously (large shops)
- Cashier login per till
- Independent shift management per till
- Bill numbering coordinated across tills (single sequence)

---

## Tamil Nadu-specific must-haves (Kovilpatti context)

Client's shopkeepers WILL ask for these in first 3 months. Confirmed
above but flagged again for prioritisation:

| # | Feature | Tier | Priority |
|---|---|---|---|
| 4 | Udhaar / credit tracking | 1 | ⭐ CRITICAL — non-negotiable |
| 1 | Return Bill | 1 | ⭐ CRITICAL — will block real usage |
| 5 | Split payment | 1 | ⭐ HIGH — cash + UPI mix is the norm |
| 9 | Weight-based products | 2 | ⭐ HIGH — snacks by kilo |
| 6 | Customer phone lookup | 1 | ⭐ HIGH — repeat customer service |
| 11 | Reprint Bill | 2 | MEDIUM — duplicate receipt requests |
| 13 | Day-end close + Z-report | 3 | MEDIUM — needed once shop owner audits |

**Not needed** (per client 21-Jul-2026):
- ❌ WhatsApp receipt
- ❌ SMS receipt
- ❌ A4 GST invoice
- ❌ Email receipt
- ❌ Kitchen printer (not a restaurant)
- ❌ E-way bill (retail scale below threshold)
- ❌ Tamil-language receipt

---

## Recommended build sequence

### Phase 4b (next 2 weeks) — TN must-haves
1. **Return Bill** (#1)
2. **Udhaar / credit** (#4 + #6 customer identification)
3. **Split payment** (#5)
4. **Cancel Bill improvements** (#2 — manager PIN + reason)

### Phase 4c (next month) — Retail essentials
5. **Product tile grid + categories** (#7)
6. **Weight-based products** (#9)
7. **Bill history filters + reprint** (#10 + #11)
8. **Discounts** (#8)

### Phase 4d (2-3 months) — Compliance + reports
9. **GST breakdown on thermal receipt** (#12)
10. **Day-end / shift close + Z-report** (#13)
11. **Cashier session per bill** (#14)
12. **Sales reports** (#15 + #16 + #17)

### Phase 5 — Advanced (as demand emerges)
- Loyalty points (#18)
- Coupon codes (#19)
- Exchange bill (#20)
- Staff purchases (#21)
- Multi-till (#22)

---

## Rough sizing (very approximate)

| Phase | Effort | Notes |
|---|---|---|
| 4b | 8-10 days | Return + Udhaar are the biggest — new DB tables + SPs + BE + FE |
| 4c | 6-8 days | Tile grid is 2-3 days on its own; discounts + weight-based are quick |
| 4d | 5-7 days | Reports need charting reuse; GST breakdown is small |
| 5 | 8-12 days | Depends on scope; loyalty/coupons are big |

Total for full roadmap: ~4-5 weeks focused work.

---

## Open questions for the client

1. **Udhaar credit limit** — should there be a per-customer cap? Or trust
   the cashier? Default suggestion: ₹5000 per customer, manager override.
2. **Return window** — how many days after purchase can customer return?
   Default suggestion: 7 days for perishables, no limit for wholesale.
3. **Cancel window** — how many hours after issue can cashier cancel?
   Default suggestion: same day (until day-end close).
4. **Cashier PIN threshold** — above what bill value does a manager PIN
   kick in for discount / cancel / large refund? Default: ₹500 for
   cash refunds, ₹200 for discount over 20%.
5. **Petty cash categories** — pre-defined list (tea / staff pay /
   repairs / rent) or free-text? Default: 5-6 pre-defined + "Other".
6. **Day-end close** — happens once per shop at day end? Or per cashier
   at shift end? Default: per shop (one close/day).

---

## Files that will be touched (rough summary)

**Backend (new + edits)**
- Repository: 8-10 new SPs, edits to `BillRepository` + `CustomerRepository`
  (new)
- Business: new services (`ReturnService`, `CustomerService`,
  `ShiftService`, `ReportService`), edits to `BillingService`
- API: 6-8 new controllers/endpoints
- DB: 6-8 new tables (customers, customer_udhaar_ledger, bill_returns,
  bill_return_items, bill_payments, shift_sessions, petty_cash_entries,
  bill_reprint_log)

**Frontend (new + edits)**
- Pages: `ShopBilling.tsx` heavy edits, new `ReturnBillDialog`,
  `UdhaarSettleDialog`, `HeldBillsDrawer`, `CustomerLookup`,
  `ShiftClose.tsx`, `BillingReports.tsx`
- Components: `PaymentStrip`, `DiscountInput`, `WeightInputDialog`,
  `ProductTileGrid`, `CategoryTabs`, `CashierZReport`
- Hooks / api: new `useCustomers`, `useReturns`, `useShifts`, `useReports`

**Print / thermal**
- `PrintBillThermal.tsx` — small edits (GST breakdown line)
- `PrintReturnThermal.tsx` — new
- `PrintZReportThermal.tsx` — new
- `PrintUdhaarSlipThermal.tsx` — new
- `PrintCancelSlipThermal.tsx` — new
