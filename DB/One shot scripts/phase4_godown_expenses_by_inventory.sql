-- ============================================================
-- ONE-SHOT: phase4_godown_expenses_by_inventory
--
-- Adds fn_accounts_godown_expenses_by_inventory — per-inventory
-- breakdown of Inventory-role staff salary (Pay / Deduct) in range.
-- Powers the "By Godown" panel on the admin Accounts screen
-- (21-Jul-2026 client req: mirror the existing "By Shop" table for
-- godowns so the owner sees which godown spent what).
--
-- Same source data as the existing fn_accounts_godown_expenses
-- (staff_salary_other_transactions) — just grouped by users.inventory_id.
--
-- Idempotent — safe to re-run. `CREATE OR REPLACE FUNCTION`.
-- Prereqs: staff_salary_other_transactions + inventories tables must
-- exist (from phase 1 + phase 4 baseline).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_accounts_godown_expenses_by_inventory(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  inventory_id   uuid,
  inventory_code varchar,
  inventory_name varchar,
  amount         numeric
)
LANGUAGE sql STABLE AS $$
  SELECT u.inventory_id,
         i.code AS inventory_code,
         i.name AS inventory_name,
         COALESCE(SUM(t.amount), 0)::numeric(14,2) AS amount
  FROM   staff_salary_other_transactions t
  JOIN   users       u ON u.id = t.staff_id
  JOIN   inventories i ON i.id = u.inventory_id
  WHERE  t.is_deleted = false
    AND  t.txn_date >= p_from
    AND  t.txn_date <= p_to
    AND  u.inventory_id IS NOT NULL
  GROUP BY u.inventory_id, i.code, i.name
  ORDER BY i.name;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- 1. SP exists:
--    SELECT proname FROM pg_proc
--    WHERE proname = 'fn_accounts_godown_expenses_by_inventory';
--
-- 2. Sum-check: the by-inventory rows should sum to the same total as
--    the scalar SP for the same date range.
--    SELECT (SELECT SUM(amount)
--            FROM fn_accounts_godown_expenses_by_inventory(
--                    current_date - interval '30 days', current_date))
--         AS by_inventory_total,
--           fn_accounts_godown_expenses(
--                    current_date - interval '30 days', current_date)
--         AS scalar_total;
--    -- The two figures should match (minus any staff without an
--    -- inventory_id, which the by-inventory SP excludes by design).
-- ============================================================
