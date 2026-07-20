-- ============================================================
-- Kovilpatti Snacks — Phase 4 PROCEDURES addendum — Staff Salary
-- (re-runnable, CREATE OR REPLACE)
--
-- Run AFTER phase4_staff_salary_init.sql.
-- ============================================================

-- ============== Staff Salary — master amount =====================

CREATE OR REPLACE FUNCTION fn_staff_salary_set(
  p_staff_id       uuid,
  p_monthly_amount numeric,
  p_effective_from date,
  p_user_id        uuid
)
RETURNS TABLE (
  staff_id       uuid,
  monthly_amount numeric,
  effective_from date,
  created_at     timestamptz,
  updated_at     timestamptz
)
LANGUAGE sql AS $$
  INSERT INTO staff_salaries (staff_id, monthly_amount, effective_from, created_by, updated_by)
  VALUES (p_staff_id, p_monthly_amount, p_effective_from, p_user_id, p_user_id)
  ON CONFLICT (staff_id) DO UPDATE
    SET monthly_amount = EXCLUDED.monthly_amount,
        effective_from = EXCLUDED.effective_from,
        updated_by     = EXCLUDED.updated_by,
        updated_at     = now()
  RETURNING staff_id, monthly_amount, effective_from, created_at, updated_at;
$$;

-- ============== Staff Salary — transactions =======================

-- ShopUser-role staff: Pay/Deduct writes straight into shop_utility_expenses
-- under category 'Staff Salary', tagged with staff_id. This is the exact
-- table fn_accounts_utilities_breakdown() sums for Admin Accounts, so the
-- tally is automatic — no Accounts SP or FE code needs to change.
-- p_amount is signed: positive for Pay, negative for Deduct (decided by the
-- calling service, not here).
CREATE OR REPLACE FUNCTION fn_staff_salary_shop_txn_create(
  p_shop_id  uuid,
  p_staff_id uuid,
  p_amount   numeric,
  p_note     varchar,
  p_txn_date date,
  p_user_id  uuid
)
RETURNS TABLE (
  id           uuid,
  shop_id      uuid,
  staff_id     uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql AS $$
  INSERT INTO shop_utility_expenses
    (shop_id, staff_id, category, amount, note, expense_date, created_by, updated_by)
  VALUES
    (p_shop_id, p_staff_id, 'Staff Salary', p_amount, p_note, p_txn_date, p_user_id, p_user_id)
  RETURNING id, shop_id, staff_id, category, amount, note, expense_date, created_at, updated_at;
$$;

-- Inventory-role staff: no shop_id, so Pay/Deduct goes into the dedicated
-- staff_salary_other_transactions table instead — record-keeping only,
-- never read by Accounts. Same signed-amount convention as the SP above.
CREATE OR REPLACE FUNCTION fn_staff_salary_other_txn_create(
  p_staff_id uuid,
  p_amount   numeric,
  p_reason   varchar,
  p_note     varchar,
  p_txn_date date,
  p_user_id  uuid
)
RETURNS TABLE (
  id         uuid,
  staff_id   uuid,
  amount     numeric,
  reason     varchar,
  note       varchar,
  txn_date   date,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql AS $$
  INSERT INTO staff_salary_other_transactions
    (staff_id, amount, reason, note, txn_date, created_by, updated_by)
  VALUES
    (p_staff_id, p_amount, p_reason, p_note, p_txn_date, p_user_id, p_user_id)
  RETURNING id, staff_id, amount, reason, note, txn_date, created_at, updated_at;
$$;

-- ============== Staff Salary — rollup for the Salary tab ==========

-- One row per non-admin staff member for the given month/range: expected
-- monthly amount, actual paid/deducted/net for that range, and whether
-- this staff's entries are reflected in Accounts (ShopUser only).
CREATE OR REPLACE FUNCTION fn_staff_salary_get_all(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  staff_id       uuid,
  full_name      varchar,
  role           varchar,
  shop_id        uuid,
  shop_name      varchar,
  inventory_id   uuid,
  inventory_name varchar,
  monthly_amount numeric,
  paid           numeric,
  deducted       numeric,
  net            numeric,
  in_accounts    boolean
)
LANGUAGE sql STABLE AS $$
  WITH shop_txns AS (
    SELECT e.staff_id,
           SUM(e.amount) FILTER (WHERE e.amount > 0) AS paid,
           SUM(e.amount) FILTER (WHERE e.amount < 0) AS deducted
    FROM shop_utility_expenses e
    WHERE e.is_deleted   = false
      AND e.category     = 'Staff Salary'
      AND e.staff_id      IS NOT NULL
      AND e.expense_date >= p_from
      AND e.expense_date <= p_to
    GROUP BY e.staff_id
  ),
  other_txns AS (
    SELECT t.staff_id,
           SUM(t.amount) FILTER (WHERE t.amount > 0) AS paid,
           SUM(t.amount) FILTER (WHERE t.amount < 0) AS deducted
    FROM staff_salary_other_transactions t
    WHERE t.is_deleted = false
      AND t.txn_date   >= p_from
      AND t.txn_date   <= p_to
    GROUP BY t.staff_id
  )
  SELECT
    u.id                                                            AS staff_id,
    u.full_name,
    fn_user_role_label(u.role)                                      AS role,
    u.shop_id,
    s.name                                                          AS shop_name,
    u.inventory_id,
    i.name                                                          AS inventory_name,
    COALESCE(ss.monthly_amount, 0)                                  AS monthly_amount,
    COALESCE(st.paid, ot.paid, 0)                                   AS paid,
    COALESCE(st.deducted, ot.deducted, 0)                           AS deducted,
    COALESCE(st.paid, ot.paid, 0) + COALESCE(st.deducted, ot.deducted, 0) AS net,
    (u.role = 'shop_user')                                          AS in_accounts
  FROM users u
  LEFT JOIN shops        s  ON s.id  = u.shop_id
  LEFT JOIN inventories   i ON i.id  = u.inventory_id
  LEFT JOIN staff_salaries ss ON ss.staff_id = u.id
  LEFT JOIN shop_txns     st ON st.staff_id  = u.id
  LEFT JOIN other_txns    ot ON ot.staff_id  = u.id
  WHERE u.role <> 'admin' AND u.is_deleted = false
  ORDER BY u.full_name;
$$;

-- ============== Accounts hook — Godown Expenses ===================

-- Company-wide total of Inventory-role staff Pay/Deduct in range.
-- Godowns aren't shop-scoped the way Accounts' per-shop breakdown is, so
-- this feeds the overall Net Profit figure as its own line (alongside,
-- not blended into, per-shop Staff Salary/Utilities).
CREATE OR REPLACE FUNCTION fn_accounts_godown_expenses(
  p_from date,
  p_to   date
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0)::numeric(14,2)
  FROM staff_salary_other_transactions
  WHERE is_deleted = false
    AND txn_date >= p_from
    AND txn_date <= p_to;
$$;

-- ============== Staff Salary — guard + history (18-Jul-2026) =======

-- A staff's monthly salary must be set before any Pay/Deduct is recorded
-- against them (client req: "monthly salary set pannama, pay or deduct
-- panna kudadhu" — no ledger entry without an expected amount first).
CREATE OR REPLACE FUNCTION fn_staff_salary_exists(p_staff_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM staff_salaries WHERE staff_id = p_staff_id);
$$;

-- Per-staff Pay/Deduct history for the "hover the Net figure" breakdown —
-- unions the two possible sources (ShopUser rows live in
-- shop_utility_expenses, Inventory rows in staff_salary_other_transactions)
-- into one signed, dated list.
CREATE OR REPLACE FUNCTION fn_staff_salary_transactions_list(
  p_staff_id uuid,
  p_from     date,
  p_to       date
)
RETURNS TABLE (
  txn_date date,
  amount   numeric,
  note     varchar
)
LANGUAGE sql STABLE AS $$
  SELECT e.expense_date AS txn_date, e.amount, e.note
  FROM shop_utility_expenses e
  WHERE e.staff_id     = p_staff_id
    AND e.is_deleted   = false
    AND e.category     = 'Staff Salary'
    AND e.expense_date >= p_from
    AND e.expense_date <= p_to
  UNION ALL
  SELECT t.txn_date, t.amount,
         NULLIF(trim(BOTH ': ' FROM COALESCE(t.reason, '') || ': ' || COALESCE(t.note, '')), '') AS note
  FROM staff_salary_other_transactions t
  WHERE t.staff_id  = p_staff_id
    AND t.is_deleted = false
    AND t.txn_date  >= p_from
    AND t.txn_date  <= p_to
  ORDER BY txn_date DESC;
$$;

-- ============== Staff Salary — Bonus (18-Jul-2026) =================

-- A Bonus is recorded through the existing Pay flow with mode='Bonus'
-- (no new table/column — same reuse as Cash/UPI/Bank Transfer, just
-- another freeSolo mode value), so this just needs to find the most
-- recent such entry for the "last bonus given" note on the Bonus button.
CREATE OR REPLACE FUNCTION fn_staff_salary_last_bonus(p_staff_id uuid)
RETURNS TABLE (
  txn_date date,
  amount   numeric
)
LANGUAGE sql STABLE AS $$
  SELECT txn_date, amount FROM (
    SELECT e.expense_date AS txn_date, e.amount
    FROM shop_utility_expenses e
    WHERE e.staff_id   = p_staff_id
      AND e.is_deleted = false
      AND e.category   = 'Staff Salary'
      AND e.amount > 0
      AND e.note ILIKE '%via Bonus%'
    UNION ALL
    SELECT t.txn_date, t.amount
    FROM staff_salary_other_transactions t
    WHERE t.staff_id   = p_staff_id
      AND t.is_deleted  = false
      AND t.amount > 0
      AND t.note ILIKE '%via Bonus%'
  ) x
  ORDER BY txn_date DESC
  LIMIT 1;
$$;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_staff_salary_get_all('2026-07-01','2026-07-31');
-- SELECT * FROM fn_staff_salary_set('<staff-uuid>', 14000, '2026-07-01', '<admin-uuid>');
-- SELECT * FROM fn_staff_salary_shop_txn_create('<shop-uuid>', '<staff-uuid>', 6000, 'July salary', '2026-07-16', '<admin-uuid>');
-- SELECT * FROM fn_accounts_utilities_breakdown('2026-07-01','2026-07-31', NULL); -- confirm the row nets in
-- ============================================================
