-- ============================================================
-- ONE-SHOT: phase4_inventory_expenses
--
-- Adds the godown/inventory-side operating-expenses feature
-- (21-Jul-2026, client req: "shop expenses madhiri inv expenses
-- venum and adhu accounts la tally aaganum"). Mirror of the
-- shop_utility_expenses stack — inventory user logs their godown
-- expenses; admin sees them tally into the Accounts screen as a
-- separate "Inventory Expenses" line alongside Shop Expenses.
--
-- DELIVERS
--   1. inventory_expenses table (+ index + updated_at trigger)
--   2. CRUD SPs: fn_inventory_expense_list / _get / _create /
--      _update / _soft_delete
--   3. Accounts rollup SP: fn_accounts_inventory_expenses_breakdown
--      (per-inventory-per-category totals for admin dashboard)
--
-- PREREQS: `inventories`, `users`, and the `set_updated_at()`
-- trigger function from Phase 1 must already exist. Every fresh
-- DB gets these from phase1_init.sql + phase1_procedures.sql.
--
-- Idempotent — safe to re-run. `CREATE TABLE IF NOT EXISTS`,
-- `CREATE OR REPLACE FUNCTION`, and `DROP TRIGGER IF EXISTS`
-- guard every step.
-- ============================================================

BEGIN;

-- ────── 1. Schema ──────
CREATE TABLE IF NOT EXISTS inventory_expenses (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  uuid          NOT NULL REFERENCES inventories(id) ON DELETE RESTRICT,

  category      varchar(50)   NOT NULL,
  amount        numeric(10,2) NOT NULL,
  note          varchar(500),
  expense_date  date          NOT NULL,

  is_deleted    boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_inventory_expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_inventory_expenses_category_not_blank CHECK (length(trim(category)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_expenses_inventory_date
  ON inventory_expenses(inventory_id, expense_date DESC)
  WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_inventory_expenses_updated ON inventory_expenses;
CREATE TRIGGER trg_inventory_expenses_updated BEFORE UPDATE ON inventory_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ────── 2. CRUD SPs ──────
CREATE OR REPLACE FUNCTION fn_inventory_expense_list(
  p_inventory_id uuid,
  p_from_date    date DEFAULT NULL,
  p_to_date      date DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  inventory_id uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.inventory_id, e.category, e.amount, e.note, e.expense_date,
         e.created_at, e.updated_at
  FROM inventory_expenses e
  WHERE e.inventory_id = p_inventory_id
    AND e.is_deleted = false
    AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
    AND (p_to_date   IS NULL OR e.expense_date <= p_to_date)
  ORDER BY e.expense_date DESC, e.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_expense_get(p_id uuid)
RETURNS TABLE (
  id           uuid,
  inventory_id uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.inventory_id, e.category, e.amount, e.note, e.expense_date,
         e.created_at, e.updated_at
  FROM inventory_expenses e
  WHERE e.id = p_id AND e.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_expense_create(
  p_inventory_id uuid,
  p_category     varchar,
  p_amount       numeric,
  p_note         varchar,
  p_expense_date date,
  p_user_id      uuid
)
RETURNS TABLE (
  id           uuid,
  inventory_id uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql AS $$
  INSERT INTO inventory_expenses
    (inventory_id, category, amount, note, expense_date, created_by, updated_by)
  VALUES
    (p_inventory_id, p_category, p_amount, p_note, p_expense_date, p_user_id, p_user_id)
  RETURNING id, inventory_id, category, amount, note, expense_date, created_at, updated_at;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_expense_update(
  p_id           uuid,
  p_category     varchar,
  p_amount       numeric,
  p_note         varchar,
  p_expense_date date,
  p_user_id      uuid
)
RETURNS TABLE (
  id           uuid,
  inventory_id uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql AS $$
  UPDATE inventory_expenses
  SET category     = p_category,
      amount       = p_amount,
      note         = p_note,
      expense_date = p_expense_date,
      updated_by   = p_user_id,
      updated_at   = now()
  WHERE id = p_id AND is_deleted = false
  RETURNING id, inventory_id, category, amount, note, expense_date, created_at, updated_at;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_expense_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inventory_expenses
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;


-- ────── 3. Accounts rollup ──────
CREATE OR REPLACE FUNCTION fn_accounts_inventory_expenses_breakdown(
  p_from          date,
  p_to            date,
  p_inventory_ids uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  inventory_id     uuid,
  inventory_code   varchar,
  inventory_name   varchar,
  category         varchar,
  amount           numeric,
  expense_count    bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.inventory_id,
    i.code                            AS inventory_code,
    i.name                            AS inventory_name,
    e.category,
    SUM(e.amount)::numeric(14,2)      AS amount,
    COUNT(*)::bigint                  AS expense_count
  FROM inventory_expenses e
  JOIN inventories i ON i.id = e.inventory_id
  WHERE e.is_deleted   = false
    AND i.is_deleted   = false
    AND e.expense_date >= p_from
    AND e.expense_date <= p_to
    AND (p_inventory_ids IS NULL OR cardinality(p_inventory_ids) = 0
         OR e.inventory_id = ANY(p_inventory_ids))
  GROUP BY e.inventory_id, i.code, i.name, e.category
  ORDER BY i.name, e.category;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- 1. Table exists:
--    \dt inventory_expenses
--    SELECT COUNT(*) FROM inventory_expenses;
--
-- 2. SPs exist (6 rows expected):
--    SELECT proname FROM pg_proc
--    WHERE proname LIKE 'fn_inventory_expense%'
--       OR proname = 'fn_accounts_inventory_expenses_breakdown';
--
-- 3. Smoke-test the CRUD flow (replace UUIDs with real ones):
--    SELECT * FROM fn_inventory_expense_create(
--      '<inventory-uuid>'::uuid,
--      'Rent', 15000, 'July rent',
--      current_date,
--      '<user-uuid>'::uuid);
--    SELECT * FROM fn_inventory_expense_list('<inventory-uuid>'::uuid);
--    SELECT * FROM fn_accounts_inventory_expenses_breakdown(
--      current_date - interval '30 days', current_date, NULL);
-- ============================================================
