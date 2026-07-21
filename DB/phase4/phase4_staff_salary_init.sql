-- ============================================================
-- Kovilpatti Snacks — Phase 4 SCHEMA addendum — Staff Salary (DDL only)
--
-- Backs the new "Salary" tab on the Admin Staff screen
-- (front-end/src/pages/Staff.tsx). Two new tables + one extension of the
-- existing shop_utility_expenses table.
--
-- Design: ShopUser-role staff Pay/Deduct entries are written directly into
-- shop_utility_expenses (category = 'Staff Salary', tagged with the new
-- staff_id column) so they automatically flow through the existing
-- fn_accounts_utilities_breakdown() that Admin Accounts already reads —
-- zero changes needed to Accounts itself, tally is guaranteed by
-- construction. Inventory-role staff have no shop_id (Accounts is
-- shop-scoped only) so their Pay/Deduct entries go into a separate
-- staff_salary_other_transactions table instead, for record-keeping only —
-- they never reach Accounts.
--
-- Run AFTER phase4_init.sql (needs shop_utility_expenses, users, shops,
-- inventories, set_updated_at()).
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_staff_salary_init.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Extend shop_utility_expenses — tag rows by staff, allow negative
--    amounts (a Deduct/advance-recovery entry nets against Pay entries via
--    plain SUM() in fn_accounts_utilities_breakdown, no SP changes needed).
-- ------------------------------------------------------------
ALTER TABLE shop_utility_expenses
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shop_utility_expenses_staff
  ON shop_utility_expenses(staff_id)
  WHERE is_deleted = false;

ALTER TABLE shop_utility_expenses
  DROP CONSTRAINT IF EXISTS chk_shop_utility_expenses_amount_positive;

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS" — guard it explicitly so
-- this file stays safely re-runnable, same as everything else in it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_shop_utility_expenses_amount_nonzero'
  ) THEN
    ALTER TABLE shop_utility_expenses
      ADD CONSTRAINT chk_shop_utility_expenses_amount_nonzero CHECK (amount <> 0);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. staff_salaries — the "expected monthly amount" master. One row per
--    staff, upserted by the Set Monthly Salary dialog. Setting this alone
--    posts nothing to any ledger — it's just the expected figure the
--    Salary tab compares actual Pay/Deduct totals against.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_salaries (
  staff_id        uuid          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_amount  numeric(10,2) NOT NULL,
  effective_from  date          NOT NULL,

  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  updated_by      uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_staff_salaries_amount_positive CHECK (monthly_amount > 0)
);

DROP TRIGGER IF EXISTS trg_staff_salaries_updated ON staff_salaries;
CREATE TRIGGER trg_staff_salaries_updated BEFORE UPDATE ON staff_salaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- 3. staff_salary_other_transactions — Pay/Deduct history for
--    Inventory-role staff only (no shop_id to attach to
--    shop_utility_expenses). Record-keeping only; never read by Accounts.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_salary_other_transactions (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount      numeric(10,2) NOT NULL,
  -- 'Payment' entries are positive, 'Deduction'/advance-recovery entries
  -- are negative — same sign convention as the mirrored shop_utility_expenses
  -- rows, so a single net = SUM(amount) works identically on both sides.
  reason      varchar(50),
  note        varchar(500),
  txn_date    date          NOT NULL,

  is_deleted  boolean       NOT NULL DEFAULT false,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  created_by  uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  uuid          REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT chk_staff_salary_other_txn_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_staff_salary_other_txn_staff_date
  ON staff_salary_other_transactions(staff_id, txn_date DESC)
  WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_staff_salary_other_txn_updated ON staff_salary_other_transactions;
CREATE TRIGGER trg_staff_salary_other_txn_updated BEFORE UPDATE ON staff_salary_other_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- \d shop_utility_expenses
-- \dt staff_salaries staff_salary_other_transactions
-- SELECT * FROM staff_salaries LIMIT 5;
-- ============================================================
