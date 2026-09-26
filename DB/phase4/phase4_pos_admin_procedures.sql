-- ============================================================
-- Kovilpatti Snacks — Phase 4d · POS ADMIN · PROCEDURES (SPs)
--
-- Admin-side visibility over POS billing (25-Sep-2026). Until now every
-- billing SP was shop-scoped (ShopUser only), so the owner could not see a
-- single bill, return, day-end close or credit customer. Everything here is
-- READ-ONLY except fn_shop_inventory_import_opening.
--
--   Bills           fn_admin_bill_list / fn_admin_bill_get
--   Returns         fn_admin_bill_return_list / fn_admin_bill_return_get
--   Day-end closes  fn_admin_eod_list / fn_admin_eod_denominations
--   Credit          fn_admin_customer_list / fn_admin_customer_ledger
--   Sales reports   fn_admin_sales_summary / _by_shop / _daily / _top_products
--   Opening stock   fn_shop_inventory_import_opening
--
-- Items / tenders / return lines reuse the existing shop-agnostic readers
-- (fn_bill_get_items, fn_bill_get_payments, fn_bill_return_get_items).
--
-- Date filters: p_from / p_to are IST calendar dates, inclusive. They are
-- converted to a timestamptz range ONCE ([from 00:00 IST, to+1 00:00 IST))
-- so the created_at indexes stay usable — no per-row AT TIME ZONE cast.
--
-- Run AFTER (fresh deploy):
--   phase4_shop_inventory_procedures.sql  (fn_shop_inventory_apply_movement)
--   phase4_billing_procedures.sql
--   phase4_eod_procedures.sql
-- All functions DROP IF EXISTS + CREATE — safe to re-run.
-- ============================================================


-- ============================================================
-- BILLS
-- ============================================================

-- p_shop_id NULL = all shops. p_payment_mode matches bills that have AT
-- LEAST ONE tender of that mode (so 'UPI' also finds Cash+UPI splits).
-- p_search matches bill code, customer name or phone.
DROP FUNCTION IF EXISTS fn_admin_bill_list(uuid, varchar, varchar, varchar, date, date, int, int);
CREATE FUNCTION fn_admin_bill_list(
  p_shop_id       uuid    DEFAULT NULL,
  p_search        varchar DEFAULT NULL,
  p_status        varchar DEFAULT NULL,
  p_payment_mode  varchar DEFAULT NULL,
  p_from          date    DEFAULT NULL,
  p_to            date    DEFAULT NULL,
  p_page          int     DEFAULT 1,
  p_page_size     int     DEFAULT 25
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  shop_id            uuid,
  shop_code          varchar,
  shop_name          varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  subtotal           numeric,
  discount_amount    numeric,
  total_amount       numeric,
  returned_amount    numeric,
  customer_name      varchar,
  customer_phone     varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  total_count        bigint
)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.code,
         b.shop_id, s.code AS shop_code, s.name AS shop_name,
         b.status, b.payment_mode,
         b.total_items, b.total_qty,
         b.subtotal, b.discount_amount, b.total_amount,
         COALESCE(r.returned_amount, 0)::numeric(12,2) AS returned_amount,
         cust.name  AS customer_name,
         cust.phone AS customer_phone,
         b.created_at,
         cu.full_name AS created_by_name,
         b.cancelled_at,
         xu.full_name AS cancelled_by_name,
         b.cancel_reason_type,
         b.cancel_reason,
         COUNT(*) OVER() AS total_count
  FROM   bills b
  JOIN   shops s ON s.id = b.shop_id
  LEFT   JOIN customers cust ON cust.id = b.customer_id
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  LEFT   JOIN LATERAL (
           SELECT SUM(br.total_amount) AS returned_amount
           FROM   bill_returns br
           WHERE  br.source_bill_id = b.id AND br.is_deleted = false
         ) r ON true
  WHERE  b.is_deleted = false
    AND  (p_shop_id IS NULL OR b.shop_id = p_shop_id)
    AND  (p_status IS NULL OR p_status = '' OR b.status = p_status)
    AND  (p_payment_mode IS NULL OR p_payment_mode = ''
          OR EXISTS (SELECT 1 FROM bill_payments bp
                     WHERE bp.bill_id = b.id AND bp.mode = p_payment_mode))
    AND  (p_search IS NULL OR p_search = ''
          OR b.code     ILIKE '%' || p_search || '%'
          OR cust.name  ILIKE '%' || p_search || '%'
          OR cust.phone ILIKE '%' || p_search || '%')
    AND  (p_from IS NULL OR b.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND  (p_to   IS NULL OR b.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  ORDER  BY b.created_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;


-- Bill header for the admin detail dialog — same shape as fn_bill_get plus
-- the owning shop, without the shop scope (admin sees every shop).
DROP FUNCTION IF EXISTS fn_admin_bill_get(uuid);
CREATE FUNCTION fn_admin_bill_get(
  p_bill_id  uuid
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  shop_id            uuid,
  shop_code          varchar,
  shop_name          varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  subtotal           numeric,
  discount_kind      varchar,
  discount_value     numeric,
  discount_amount    numeric,
  total_amount       numeric,
  notes              varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  customer_id        uuid,
  customer_name      varchar,
  customer_phone     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.code,
         b.shop_id, s.code, s.name,
         b.status, b.payment_mode,
         b.total_items, b.total_qty,
         b.subtotal, b.discount_kind, b.discount_value, b.discount_amount,
         b.total_amount, b.notes,
         b.created_at, cu.full_name,
         b.cancelled_at, xu.full_name,
         b.cancel_reason_type, b.cancel_reason,
         b.customer_id, cust.name, cust.phone
  FROM   bills b
  JOIN   shops s ON s.id = b.shop_id
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  LEFT   JOIN customers cust ON cust.id = b.customer_id
  WHERE  b.id = p_bill_id
    AND  b.is_deleted = false;
$$;


-- ============================================================
-- RETURNS
-- ============================================================

-- p_source_bill_id narrows to one bill's returns (bill detail dialog).
DROP FUNCTION IF EXISTS fn_admin_bill_return_list(uuid, varchar, uuid, date, date, int, int);
CREATE FUNCTION fn_admin_bill_return_list(
  p_shop_id         uuid    DEFAULT NULL,
  p_search          varchar DEFAULT NULL,
  p_source_bill_id  uuid    DEFAULT NULL,
  p_from            date    DEFAULT NULL,
  p_to              date    DEFAULT NULL,
  p_page            int     DEFAULT 1,
  p_page_size       int     DEFAULT 25
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  shop_id          uuid,
  shop_code        varchar,
  shop_name        varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar,
  total_count      bigint
)
LANGUAGE sql STABLE AS $$
  SELECT br.id, br.code,
         br.shop_id, s.code, s.name,
         br.source_bill_id, b.code AS source_bill_code,
         br.refund_mode, br.reason_type, br.reason_note,
         br.total_items, br.total_qty, br.total_amount,
         br.created_at, u.full_name,
         COUNT(*) OVER() AS total_count
  FROM   bill_returns br
  JOIN   bills b ON b.id = br.source_bill_id
  JOIN   shops s ON s.id = br.shop_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.is_deleted = false
    AND  (p_shop_id IS NULL OR br.shop_id = p_shop_id)
    AND  (p_source_bill_id IS NULL OR br.source_bill_id = p_source_bill_id)
    AND  (p_search IS NULL OR p_search = ''
          OR br.code ILIKE '%' || p_search || '%'
          OR b.code  ILIKE '%' || p_search || '%')
    AND  (p_from IS NULL OR br.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND  (p_to   IS NULL OR br.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  ORDER  BY br.created_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;


DROP FUNCTION IF EXISTS fn_admin_bill_return_get(uuid);
CREATE FUNCTION fn_admin_bill_return_get(
  p_return_id  uuid
)
RETURNS TABLE (
  id               uuid,
  code             varchar,
  shop_id          uuid,
  shop_code        varchar,
  shop_name        varchar,
  source_bill_id   uuid,
  source_bill_code varchar,
  refund_mode      varchar,
  reason_type      varchar,
  reason_note      varchar,
  total_items      int,
  total_qty        int,
  total_amount     numeric,
  created_at       timestamptz,
  created_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  SELECT br.id, br.code,
         br.shop_id, s.code, s.name,
         br.source_bill_id, b.code,
         br.refund_mode, br.reason_type, br.reason_note,
         br.total_items, br.total_qty, br.total_amount,
         br.created_at, u.full_name
  FROM   bill_returns br
  JOIN   bills b ON b.id = br.source_bill_id
  JOIN   shops s ON s.id = br.shop_id
  LEFT   JOIN users u ON u.id = br.created_by
  WHERE  br.id = p_return_id
    AND  br.is_deleted = false;
$$;


-- ============================================================
-- DAY-END CLOSES (cash_sessions)
-- ============================================================

-- p_from / p_to filter on closed_at (IST dates). p_variance_only keeps only
-- closes where the counted cash didn't match the expected cash.
DROP FUNCTION IF EXISTS fn_admin_eod_list(uuid, date, date, boolean, int, int);
CREATE FUNCTION fn_admin_eod_list(
  p_shop_id        uuid    DEFAULT NULL,
  p_from           date    DEFAULT NULL,
  p_to             date    DEFAULT NULL,
  p_variance_only  boolean DEFAULT false,
  p_page           int     DEFAULT 1,
  p_page_size      int     DEFAULT 25
)
RETURNS TABLE (
  id               uuid,
  shop_id          uuid,
  shop_code        varchar,
  shop_name        varchar,
  window_from      timestamptz,
  closed_at        timestamptz,
  closed_by_name   varchar,
  cash_sales       numeric,
  upi_sales        numeric,
  credit_sales     numeric,
  cash_refunds     numeric,
  upi_refunds      numeric,
  cancel_cash_back numeric,
  cancel_upi_back  numeric,
  cash_settlements numeric,
  upi_settlements  numeric,
  expected_cash    numeric,
  physical_cash    numeric,
  variance         numeric,
  notes            varchar,
  total_count      bigint
)
LANGUAGE sql STABLE AS $$
  SELECT cs.id,
         cs.shop_id, s.code, s.name,
         cs.window_from, cs.closed_at, u.full_name,
         cs.cash_sales, cs.upi_sales, cs.credit_sales,
         cs.cash_refunds, cs.upi_refunds, cs.cancel_cash_back,
         cs.cancel_upi_back, cs.cash_settlements, cs.upi_settlements,
         cs.expected_cash, cs.physical_cash, cs.variance, cs.notes,
         COUNT(*) OVER() AS total_count
  FROM   cash_sessions cs
  JOIN   shops s ON s.id = cs.shop_id
  LEFT   JOIN users u ON u.id = cs.closed_by
  WHERE  cs.is_deleted = false
    AND  (p_shop_id IS NULL OR cs.shop_id = p_shop_id)
    AND  (NOT COALESCE(p_variance_only, false) OR cs.variance <> 0)
    AND  (p_from IS NULL OR cs.closed_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND  (p_to   IS NULL OR cs.closed_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
  ORDER  BY cs.closed_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;


-- Per-note count behind one close (admin drill-down). Highest note first.
DROP FUNCTION IF EXISTS fn_admin_eod_denominations(uuid);
CREATE FUNCTION fn_admin_eod_denominations(
  p_session_id  uuid
)
RETURNS TABLE (
  denomination  int,
  count         int,
  amount        numeric
)
LANGUAGE sql STABLE AS $$
  SELECT d.denomination, d.count, (d.denomination * d.count)::numeric(12,2)
  FROM   cash_denominations d
  WHERE  d.session_id = p_session_id
  ORDER  BY d.denomination DESC;
$$;


-- ============================================================
-- CREDIT CUSTOMERS (udhaar)
-- ============================================================

-- total_outstanding = Σ credit_balance over the FILTERED set (window SUM),
-- so the page can show "₹X outstanding across N customers" in one call.
DROP FUNCTION IF EXISTS fn_admin_customer_list(uuid, varchar, boolean, int, int);
CREATE FUNCTION fn_admin_customer_list(
  p_shop_id           uuid    DEFAULT NULL,
  p_search            varchar DEFAULT NULL,
  p_outstanding_only  boolean DEFAULT true,
  p_page              int     DEFAULT 1,
  p_page_size         int     DEFAULT 25
)
RETURNS TABLE (
  id                  uuid,
  code                varchar,
  shop_id             uuid,
  shop_code           varchar,
  shop_name           varchar,
  name                varchar,
  phone               varchar,
  credit_limit        numeric,
  credit_balance      numeric,
  last_credit_at      timestamptz,
  last_settlement_at  timestamptz,
  created_at          timestamptz,
  total_outstanding   numeric,
  total_count         bigint
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.code,
         c.shop_id, s.code, s.name,
         c.name, c.phone, c.credit_limit, c.credit_balance,
         l.last_credit_at, l.last_settlement_at,
         c.created_at,
         SUM(c.credit_balance) OVER()::numeric(14,2) AS total_outstanding,
         COUNT(*) OVER() AS total_count
  FROM   customers c
  JOIN   shops s ON s.id = c.shop_id
  LEFT   JOIN LATERAL (
           SELECT MAX(x.created_at) FILTER (WHERE x.entry_type = 'Credit')     AS last_credit_at,
                  MAX(x.created_at) FILTER (WHERE x.entry_type = 'Settlement') AS last_settlement_at
           FROM   customer_credit_ledger x
           WHERE  x.customer_id = c.id
         ) l ON true
  WHERE  c.is_deleted = false
    AND  (p_shop_id IS NULL OR c.shop_id = p_shop_id)
    AND  (NOT COALESCE(p_outstanding_only, true) OR c.credit_balance > 0)
    AND  (p_search IS NULL OR p_search = ''
          OR c.name  ILIKE '%' || p_search || '%'
          OR c.phone ILIKE '%' || p_search || '%'
          OR c.code  ILIKE '%' || p_search || '%')
  ORDER  BY c.credit_balance DESC, c.name
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;


-- Same shape as fn_customer_credit_ledger_list without the shop scope.
DROP FUNCTION IF EXISTS fn_admin_customer_ledger(uuid, int, int);
CREATE FUNCTION fn_admin_customer_ledger(
  p_customer_id  uuid,
  p_page         int DEFAULT 1,
  p_page_size    int DEFAULT 20
)
RETURNS TABLE (
  id               uuid,
  entry_type       varchar,
  amount           numeric,
  mode             varchar,
  note             varchar,
  balance_after    numeric,
  bill_code        varchar,
  created_at       timestamptz,
  created_by_name  varchar,
  total_count      bigint
)
LANGUAGE sql STABLE AS $$
  SELECT l.id, l.entry_type, l.amount, l.mode, l.note, l.balance_after,
         b.code, l.created_at, u.full_name,
         COUNT(*) OVER() AS total_count
  FROM   customer_credit_ledger l
  LEFT   JOIN bills b ON b.id = l.bill_id
  LEFT   JOIN users u ON u.id = l.created_by
  WHERE  l.customer_id = p_customer_id
  ORDER  BY l.created_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST(p_page - 1, 0) * GREATEST(p_page_size, 1);
$$;


-- ============================================================
-- SALES REPORTS
--
-- Definitions (all IST, inclusive date range):
--   Bills are dated by created_at, returns by their own created_at,
--   settlements by the ledger row's created_at.
--   sales_total      Σ total_amount of bills still Issued (post-discount)
--   gross_sales      Σ subtotal of those bills (pre-discount)
--   discount_total   gross_sales − sales_total
--   cancelled_*      bills dated in range that are now Cancelled
--   returns_total    Σ bill_returns.total_amount dated in range
--   net_sales        sales_total − returns_total
--   cash/upi/credit  tender split of the Issued bills
--   settlements_*    udhaar repayments collected (Cash / UPI)
-- ============================================================

DROP FUNCTION IF EXISTS fn_admin_sales_summary(uuid, date, date);
CREATE FUNCTION fn_admin_sales_summary(
  p_shop_id  uuid,
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  bill_count         bigint,
  gross_sales        numeric,
  discount_total     numeric,
  sales_total        numeric,
  avg_bill_value     numeric,
  cancelled_count    bigint,
  cancelled_amount   numeric,
  return_count       bigint,
  returns_total      numeric,
  net_sales          numeric,
  cash_sales         numeric,
  upi_sales          numeric,
  credit_sales       numeric,
  cash_refunds       numeric,
  upi_refunds        numeric,
  settlements_cash   numeric,
  settlements_upi    numeric
)
LANGUAGE sql STABLE AS $$
  WITH rng AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')       AS t_from,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')   AS t_to
  ),
  b AS (
    SELECT bl.*
    FROM   bills bl, rng
    WHERE  bl.is_deleted = false
      AND  (p_shop_id IS NULL OR bl.shop_id = p_shop_id)
      AND  bl.created_at >= rng.t_from AND bl.created_at < rng.t_to
  ),
  issued AS (
    SELECT COUNT(*)                          AS bill_count,
           COALESCE(SUM(subtotal), 0)        AS gross_sales,
           COALESCE(SUM(discount_amount), 0) AS discount_total,
           COALESCE(SUM(total_amount), 0)    AS sales_total
    FROM   b WHERE status = 'Issued'
  ),
  cancelled AS (
    SELECT COUNT(*) AS cancelled_count, COALESCE(SUM(total_amount), 0) AS cancelled_amount
    FROM   b WHERE status = 'Cancelled'
  ),
  tenders AS (
    SELECT COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Cash'),   0) AS cash_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'UPI'),    0) AS upi_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Credit'), 0) AS credit_sales
    FROM   b JOIN bill_payments bp ON bp.bill_id = b.id
    WHERE  b.status = 'Issued'
  ),
  rets AS (
    SELECT COUNT(*)                                                            AS return_count,
           COALESCE(SUM(br.total_amount), 0)                                   AS returns_total,
           COALESCE(SUM(br.total_amount) FILTER (WHERE br.refund_mode = 'Cash'), 0) AS cash_refunds,
           COALESCE(SUM(br.total_amount) FILTER (WHERE br.refund_mode = 'UPI'),  0) AS upi_refunds
    FROM   bill_returns br, rng
    WHERE  br.is_deleted = false
      AND  (p_shop_id IS NULL OR br.shop_id = p_shop_id)
      AND  br.created_at >= rng.t_from AND br.created_at < rng.t_to
  ),
  settle AS (
    SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.mode = 'Cash'), 0) AS settlements_cash,
           COALESCE(SUM(l.amount) FILTER (WHERE l.mode = 'UPI'),  0) AS settlements_upi
    FROM   customer_credit_ledger l
    JOIN   customers c ON c.id = l.customer_id, rng
    WHERE  l.entry_type = 'Settlement'
      AND  (p_shop_id IS NULL OR c.shop_id = p_shop_id)
      AND  l.created_at >= rng.t_from AND l.created_at < rng.t_to
  )
  SELECT i.bill_count,
         i.gross_sales::numeric(14,2),
         i.discount_total::numeric(14,2),
         i.sales_total::numeric(14,2),
         (CASE WHEN i.bill_count > 0 THEN i.sales_total / i.bill_count ELSE 0 END)::numeric(14,2),
         c.cancelled_count,
         c.cancelled_amount::numeric(14,2),
         r.return_count,
         r.returns_total::numeric(14,2),
         (i.sales_total - r.returns_total)::numeric(14,2),
         t.cash_sales::numeric(14,2),
         t.upi_sales::numeric(14,2),
         t.credit_sales::numeric(14,2),
         r.cash_refunds::numeric(14,2),
         r.upi_refunds::numeric(14,2),
         s.settlements_cash::numeric(14,2),
         s.settlements_upi::numeric(14,2)
  FROM issued i CROSS JOIN cancelled c CROSS JOIN tenders t CROSS JOIN rets r CROSS JOIN settle s;
$$;


-- One row per ACTIVE shop, including shops with no sales in the range
-- (zeros), so the owner sees which shops were idle.
DROP FUNCTION IF EXISTS fn_admin_sales_by_shop(date, date);
CREATE FUNCTION fn_admin_sales_by_shop(
  p_from  date,
  p_to    date
)
RETURNS TABLE (
  shop_id           uuid,
  shop_code         varchar,
  shop_name         varchar,
  bill_count        bigint,
  sales_total       numeric,
  discount_total    numeric,
  returns_total     numeric,
  net_sales         numeric,
  cancelled_count   bigint,
  cancelled_amount  numeric,
  cash_sales        numeric,
  upi_sales         numeric,
  credit_sales      numeric
)
LANGUAGE sql STABLE AS $$
  WITH rng AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')     AS t_from,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS t_to
  ),
  bills_agg AS (
    SELECT bl.shop_id,
           COUNT(*) FILTER (WHERE bl.status = 'Issued')                           AS bill_count,
           COALESCE(SUM(bl.total_amount)    FILTER (WHERE bl.status = 'Issued'), 0) AS sales_total,
           COALESCE(SUM(bl.discount_amount) FILTER (WHERE bl.status = 'Issued'), 0) AS discount_total,
           COUNT(*) FILTER (WHERE bl.status = 'Cancelled')                        AS cancelled_count,
           COALESCE(SUM(bl.total_amount)    FILTER (WHERE bl.status = 'Cancelled'), 0) AS cancelled_amount
    FROM   bills bl, rng
    WHERE  bl.is_deleted = false
      AND  bl.created_at >= rng.t_from AND bl.created_at < rng.t_to
    GROUP  BY bl.shop_id
  ),
  tender_agg AS (
    SELECT bl.shop_id,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Cash'),   0) AS cash_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'UPI'),    0) AS upi_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Credit'), 0) AS credit_sales
    FROM   bills bl
    JOIN   bill_payments bp ON bp.bill_id = bl.id, rng
    WHERE  bl.is_deleted = false AND bl.status = 'Issued'
      AND  bl.created_at >= rng.t_from AND bl.created_at < rng.t_to
    GROUP  BY bl.shop_id
  ),
  ret_agg AS (
    SELECT br.shop_id, COALESCE(SUM(br.total_amount), 0) AS returns_total
    FROM   bill_returns br, rng
    WHERE  br.is_deleted = false
      AND  br.created_at >= rng.t_from AND br.created_at < rng.t_to
    GROUP  BY br.shop_id
  )
  SELECT s.id, s.code, s.name,
         COALESCE(ba.bill_count, 0),
         COALESCE(ba.sales_total, 0)::numeric(14,2),
         COALESCE(ba.discount_total, 0)::numeric(14,2),
         COALESCE(ra.returns_total, 0)::numeric(14,2),
         (COALESCE(ba.sales_total, 0) - COALESCE(ra.returns_total, 0))::numeric(14,2),
         COALESCE(ba.cancelled_count, 0),
         COALESCE(ba.cancelled_amount, 0)::numeric(14,2),
         COALESCE(ta.cash_sales, 0)::numeric(14,2),
         COALESCE(ta.upi_sales, 0)::numeric(14,2),
         COALESCE(ta.credit_sales, 0)::numeric(14,2)
  FROM   shops s
  LEFT   JOIN bills_agg  ba ON ba.shop_id = s.id
  LEFT   JOIN tender_agg ta ON ta.shop_id = s.id
  LEFT   JOIN ret_agg    ra ON ra.shop_id = s.id
  WHERE  s.is_deleted = false
    AND  (s.active = true OR ba.shop_id IS NOT NULL OR ra.shop_id IS NOT NULL)
  ORDER  BY (COALESCE(ba.sales_total, 0) - COALESCE(ra.returns_total, 0)) DESC, s.name;
$$;


-- One row per IST calendar day in [p_from, p_to], zero-filled. Capped at
-- 366 days by the service so a bad range can't generate a huge series.
DROP FUNCTION IF EXISTS fn_admin_sales_daily(uuid, date, date);
CREATE FUNCTION fn_admin_sales_daily(
  p_shop_id  uuid,
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  day              date,
  bill_count       bigint,
  sales_total      numeric,
  returns_total    numeric,
  net_sales        numeric,
  cancelled_count  bigint,
  cash_sales       numeric,
  upi_sales        numeric,
  credit_sales     numeric
)
LANGUAGE sql STABLE AS $$
  WITH rng AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')     AS t_from,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS t_to
  ),
  days AS (
    SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d
  ),
  b AS (
    SELECT bl.id, bl.status, bl.total_amount,
           (bl.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day
    FROM   bills bl, rng
    WHERE  bl.is_deleted = false
      AND  (p_shop_id IS NULL OR bl.shop_id = p_shop_id)
      AND  bl.created_at >= rng.t_from AND bl.created_at < rng.t_to
  ),
  bills_agg AS (
    SELECT day,
           COUNT(*) FILTER (WHERE status = 'Issued')                        AS bill_count,
           COALESCE(SUM(total_amount) FILTER (WHERE status = 'Issued'), 0)  AS sales_total,
           COUNT(*) FILTER (WHERE status = 'Cancelled')                     AS cancelled_count
    FROM   b GROUP BY day
  ),
  tender_agg AS (
    SELECT b.day,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Cash'),   0) AS cash_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'UPI'),    0) AS upi_sales,
           COALESCE(SUM(bp.amount) FILTER (WHERE bp.mode = 'Credit'), 0) AS credit_sales
    FROM   b JOIN bill_payments bp ON bp.bill_id = b.id
    WHERE  b.status = 'Issued'
    GROUP  BY b.day
  ),
  ret_agg AS (
    SELECT (br.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           COALESCE(SUM(br.total_amount), 0) AS returns_total
    FROM   bill_returns br, rng
    WHERE  br.is_deleted = false
      AND  (p_shop_id IS NULL OR br.shop_id = p_shop_id)
      AND  br.created_at >= rng.t_from AND br.created_at < rng.t_to
    GROUP  BY 1
  )
  SELECT d.day,
         COALESCE(ba.bill_count, 0),
         COALESCE(ba.sales_total, 0)::numeric(14,2),
         COALESCE(ra.returns_total, 0)::numeric(14,2),
         (COALESCE(ba.sales_total, 0) - COALESCE(ra.returns_total, 0))::numeric(14,2),
         COALESCE(ba.cancelled_count, 0),
         COALESCE(ta.cash_sales, 0)::numeric(14,2),
         COALESCE(ta.upi_sales, 0)::numeric(14,2),
         COALESCE(ta.credit_sales, 0)::numeric(14,2)
  FROM   days d
  LEFT   JOIN bills_agg  ba ON ba.day = d.day
  LEFT   JOIN tender_agg ta ON ta.day = d.day
  LEFT   JOIN ret_agg    ra ON ra.day = d.day
  ORDER  BY d.day DESC;
$$;


-- Best sellers in the range, by revenue. Gross of returns (a return is a
-- separate event, dated separately) and pre-discount (discount is bill-
-- level, not per line). packets_sold = packet-mode lines only; loose sales
-- are reported in grams so the two units never get mixed.
DROP FUNCTION IF EXISTS fn_admin_sales_top_products(uuid, date, date, int);
CREATE FUNCTION fn_admin_sales_top_products(
  p_shop_id  uuid,
  p_from     date,
  p_to       date,
  p_limit    int DEFAULT 20
)
RETURNS TABLE (
  product_id      uuid,
  product_code    text,
  product_name    varchar,
  category_name   varchar,
  packets_sold    bigint,
  loose_weight_g  numeric,
  bill_count      bigint,
  revenue         numeric
)
LANGUAGE sql STABLE AS $$
  WITH rng AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')     AS t_from,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS t_to
  )
  SELECT p.id, p.code, p.name, c.name,
         COALESCE(SUM(bi.qty), 0)::bigint,
         COALESCE(SUM(bi.loose_weight_g), 0)::numeric(14,3),
         COUNT(DISTINCT bi.bill_id),
         SUM(bi.line_total)::numeric(14,2)
  FROM   bill_items bi
  JOIN   bills b    ON b.id = bi.bill_id
  JOIN   products p ON p.id = bi.product_id
  LEFT   JOIN categories c ON c.id = p.category_id, rng
  WHERE  b.is_deleted = false
    AND  b.status = 'Issued'
    AND  (p_shop_id IS NULL OR b.shop_id = p_shop_id)
    AND  b.created_at >= rng.t_from AND b.created_at < rng.t_to
  GROUP  BY p.id, p.code, p.name, c.name
  ORDER  BY SUM(bi.line_total) DESC, p.name
  LIMIT  GREATEST(LEAST(p_limit, 100), 1);
$$;


-- ============================================================
-- OPENING STOCK IMPORT
--
-- Sets each listed product's on-hand at a shop to the counted quantity
-- (absolute, not additive): delta = new_qty − current on-hand, written as
-- one 'Opening' movement. Products not in the file are untouched.
--
-- p_rows: jsonb array of {"rowNo": int, "code": text, "qty": numeric,
--         "unitCost": numeric|null}. The service has already rejected
--         blank codes and non-numeric / negative quantities, so here we
--         resolve products and detect duplicates.
-- code matches products.code (case-insensitive) OR products.barcode.
-- unitCost (optional) feeds the weighted-average cost on stock coming IN;
-- blank → the product's purchase_price.
--
-- p_dry_run = true  → preview only, nothing written, Error rows allowed.
-- p_dry_run = false → all-or-nothing: any Error row raises and the whole
--                     import rolls back. Each target row is locked FOR
--                     UPDATE before its delta is computed, so a sale that
--                     lands mid-import can't be overwritten.
--
-- status per row: 'Changed' | 'Unchanged' | 'Error'
-- ============================================================
DROP FUNCTION IF EXISTS fn_shop_inventory_import_opening(uuid, uuid, jsonb, boolean);
CREATE FUNCTION fn_shop_inventory_import_opening(
  p_shop_id  uuid,
  p_user_id  uuid,
  p_rows     jsonb,
  p_dry_run  boolean DEFAULT true
)
RETURNS TABLE (
  row_no        int,
  input_code    text,
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  current_qty   numeric,
  new_qty       numeric,
  delta         numeric,
  status        varchar,
  message       varchar
)
LANGUAGE plpgsql AS $$
DECLARE
  v_row       record;
  v_prod      record;
  v_seen      uuid[] := '{}';
  v_errors    int := 0;
  v_current   numeric(12,3);
  v_delta     numeric(12,3);
  v_cost      numeric(10,2);
  v_pass      int;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The file has no stock rows.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM shops s WHERE s.id = p_shop_id AND s.is_deleted = false) THEN
    RAISE EXCEPTION 'Shop not found.';
  END IF;

  -- Pass 1 validates every row (count errors); pass 2 emits results and,
  -- when applying, writes the movements. A real import with errors never
  -- reaches pass 2.
  FOR v_pass IN 1..2 LOOP
    v_seen := '{}';

    IF v_pass = 2 AND NOT p_dry_run AND v_errors > 0 THEN
      RAISE EXCEPTION 'The file has % row(s) with errors, so nothing was saved. Fix them and upload again.', v_errors;
    END IF;

    FOR v_row IN
      SELECT (x->>'rowNo')::int                 AS r_no,
             btrim(x->>'code')                  AS r_code,
             (x->>'qty')::numeric(12,3)         AS r_qty,
             NULLIF(x->>'unitCost', '')::numeric AS r_cost
      FROM   jsonb_array_elements(p_rows) x
      ORDER  BY (x->>'rowNo')::int
    LOOP
      SELECT p.id, p.code, p.name, p.purchase_price
      INTO   v_prod
      FROM   products p
      WHERE  p.is_deleted = false
        AND  (lower(p.code) = lower(v_row.r_code) OR p.barcode = v_row.r_code)
      ORDER  BY (lower(p.code) = lower(v_row.r_code)) DESC   -- code match wins over barcode
      LIMIT  1;

      IF NOT FOUND THEN
        IF v_pass = 1 THEN v_errors := v_errors + 1; CONTINUE; END IF;
        row_no := v_row.r_no; input_code := v_row.r_code;
        product_id := NULL; product_code := NULL; product_name := NULL;
        current_qty := NULL; new_qty := v_row.r_qty; delta := NULL;
        status := 'Error'; message := 'No product with this code or barcode.';
        RETURN NEXT; CONTINUE;
      END IF;

      IF v_prod.id = ANY(v_seen) THEN
        IF v_pass = 1 THEN v_errors := v_errors + 1; CONTINUE; END IF;
        row_no := v_row.r_no; input_code := v_row.r_code;
        product_id := v_prod.id; product_code := v_prod.code; product_name := v_prod.name;
        current_qty := NULL; new_qty := v_row.r_qty; delta := NULL;
        status := 'Error'; message := 'This product appears more than once in the file.';
        RETURN NEXT; CONTINUE;
      END IF;
      v_seen := v_seen || v_prod.id;

      IF v_row.r_cost IS NOT NULL AND v_row.r_cost < 0 THEN
        IF v_pass = 1 THEN v_errors := v_errors + 1; CONTINUE; END IF;
        row_no := v_row.r_no; input_code := v_row.r_code;
        product_id := v_prod.id; product_code := v_prod.code; product_name := v_prod.name;
        current_qty := NULL; new_qty := v_row.r_qty; delta := NULL;
        status := 'Error'; message := 'Unit cost cannot be negative.';
        RETURN NEXT; CONTINUE;
      END IF;

      IF v_pass = 1 THEN CONTINUE; END IF;

      -- Pass 2: current on-hand. When applying, make sure the row exists and
      -- lock it so the delta is computed against a value nobody else can
      -- change before our movement lands.
      IF p_dry_run THEN
        SELECT si.on_hand INTO v_current
        FROM shop_inventory si
        WHERE si.shop_id = p_shop_id AND si.product_id = v_prod.id;
        v_current := COALESCE(v_current, 0);
      ELSE
        INSERT INTO shop_inventory (shop_id, product_id, on_hand, avg_cost, updated_at)
        VALUES (p_shop_id, v_prod.id, 0, 0, now())
        ON CONFLICT ON CONSTRAINT shop_inventory_pkey DO NOTHING;

        SELECT si.on_hand INTO v_current
        FROM shop_inventory si
        WHERE si.shop_id = p_shop_id AND si.product_id = v_prod.id
        FOR UPDATE;
      END IF;

      v_delta := v_row.r_qty - v_current;

      IF v_delta <> 0 AND NOT p_dry_run THEN
        v_cost := CASE WHEN v_delta > 0 THEN COALESCE(v_row.r_cost, v_prod.purchase_price, 0) END;
        PERFORM fn_shop_inventory_apply_movement(
          p_shop_id, v_prod.id, 'Opening', v_delta, v_cost,
          'Opening', NULL, 'Opening stock import', p_user_id);
      END IF;

      row_no := v_row.r_no; input_code := v_row.r_code;
      product_id := v_prod.id; product_code := v_prod.code; product_name := v_prod.name;
      current_qty := v_current; new_qty := v_row.r_qty; delta := v_delta;
      status := CASE WHEN v_delta = 0 THEN 'Unchanged' ELSE 'Changed' END;
      message := NULL;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;
