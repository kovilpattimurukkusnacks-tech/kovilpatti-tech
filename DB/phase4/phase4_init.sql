-- ============================================================
-- Kovilpatti Snacks — Phase 4 SCHEMA (DDL only — no seed data)
--
-- Shop Utility / Operating Expenses (electricity, rent, staff salary,
-- maintenance, etc.) — the backend for the shop-facing Utilities screen
-- (front-end/src/pages/shop/ShopUtilities.tsx), which today only holds
-- entries in local React state. This gives it real persistence.
--
-- Scope: ShopUser only. Every row belongs to exactly one shop; the BE
-- always resolves shop_id from the logged-in user's JWT claim, never
-- from a client-supplied value (same pattern as stock_requests).
--
-- Run AFTER all Phase 1–3 init + procedure files have been applied
-- (needs `shops`, `users`, and `set_updated_at()` from Phase 1).
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_init.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. shop_utility_expenses
--    One row per logged expense. `category` is free text (not an enum) —
--    the FE offers a suggested list (Electricity, Rent, Water, Staff
--    Salary, Maintenance, Internet/Wifi, Others) via a free-typing
--    Autocomplete, but a shop can log anything; unrecognised categories
--    just fall back to a generic display on the FE side.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_utility_expenses (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,

  category      varchar(50)   NOT NULL,
  amount        numeric(10,2) NOT NULL,
  -- Optional free-text note (e.g. "EB bill — June"). Same 500-char cap as
  -- other free-text note fields in this codebase (stock_requests.notes).
  note          varchar(500),
  expense_date  date          NOT NULL,

  is_deleted    boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_shop_utility_expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_shop_utility_expenses_category_not_blank CHECK (length(trim(category)) > 0)
);

-- Drives the shop's list view: "my expenses, most recent first",
-- optionally date-ranged. Partial (is_deleted = false) since soft-deleted
-- rows are never read back.
CREATE INDEX IF NOT EXISTS idx_shop_utility_expenses_shop_date
  ON shop_utility_expenses(shop_id, expense_date DESC)
  WHERE is_deleted = false;

-- ------------------------------------------------------------
-- 2. updated_at trigger (reuses Phase 1's set_updated_at function)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_shop_utility_expenses_updated ON shop_utility_expenses;
CREATE TRIGGER trg_shop_utility_expenses_updated BEFORE UPDATE ON shop_utility_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. inventory_expenses (21-Jul-2026 client req)
--    Same shape as shop_utility_expenses but scoped to a godown /
--    inventory (warehouse rent, loading charges, packing material,
--    transport fuel, staff salary, etc.). Categories reuse the same
--    autocomplete list as the shop side — godowns pay Rent /
--    Electricity / Salary / Maintenance too. Scope: Inventory user
--    can log for their own godown; Admin explicitly NOT allowed per
--    client spec (owner delegates entirely to godown staff).
--
--    Tallied on the admin Accounts screen as a separate line from
--    Shop Expenses so the client sees the split ("₹X went to shops,
--    ₹Y went to godown"). Net Profit = Gross P&L − Shop Expenses
--    − Inventory Expenses.
-- ------------------------------------------------------------
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

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- \dt shop_utility_expenses
-- SELECT * FROM shop_utility_expenses LIMIT 5;
-- ============================================================
