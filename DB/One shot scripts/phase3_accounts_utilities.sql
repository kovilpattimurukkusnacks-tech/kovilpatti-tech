-- ============================================================
-- ONE-SHOT: phase3_accounts_utilities
--
-- Adds fn_accounts_utilities_breakdown — per-shop-per-category rollup of
-- shop_utility_expenses (Rent / Electricity / Staff Salary / …) that
-- powers the Net Profit KPI + Utilities columns on the admin Accounts +
-- Dashboard screens (15-Jul-2026, client req: "shop bills la ellam
-- kalanjaa dhan real profit").
--
-- Idempotent: CREATE OR REPLACE FUNCTION — safe to re-run.
-- Prereqs:    phase4 tables installed (shop_utility_expenses exists).
--             If phase4 hasn't been applied on this DB, this script
--             will fail cleanly with "relation shop_utility_expenses
--             does not exist" — apply phase4_init.sql first.
--
-- Filter surface deliberately narrower than the other fn_accounts_*
-- reports:
--   • p_shop_ids applies (utilities are per-shop).
--   • p_inv_ids  — utilities aren't tied to a godown → not a parameter.
--   • p_cat_ids  — refers to *product* categories on the other reports;
--     the utility taxonomy (Rent/Water/…) is different and free-text.
--     Applying the product-category filter would meaninglessly zero out
--     utilities → not a parameter.
--
-- Date semantics: expense_date is a plain `date` (IST calendar day). No
-- IST-to-UTC conversion needed. Range is inclusive on both ends
-- [p_from, p_to], matching the plain-date semantics (unlike the
-- timestamptz half-open range used by the other accounts SPs).
-- ============================================================

BEGIN;

-- Safety check: fail fast with a friendlier error than the raw
-- "relation does not exist" if phase4 hasn't been applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'shop_utility_expenses'
  ) THEN
    RAISE EXCEPTION 'shop_utility_expenses table not found — apply phase4_init.sql before this script.';
  END IF;
END
$$;


CREATE OR REPLACE FUNCTION fn_accounts_utilities_breakdown(
  p_from     date,
  p_to       date,
  p_shop_ids uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  shop_id       uuid,
  shop_code     varchar,
  shop_name     varchar,
  category      varchar,
  amount        numeric,
  expense_count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.shop_id,
    s.code                            AS shop_code,
    s.name                            AS shop_name,
    e.category,
    SUM(e.amount)::numeric(14,2)      AS amount,
    COUNT(*)::bigint                  AS expense_count
  FROM shop_utility_expenses e
  JOIN shops s ON s.id = e.shop_id
  WHERE e.is_deleted   = false
    AND s.is_deleted   = false
    AND e.expense_date >= p_from
    AND e.expense_date <= p_to
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR e.shop_id = ANY(p_shop_ids))
  GROUP BY e.shop_id, s.code, s.name, e.category
  ORDER BY s.name, e.category;
$$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- SELECT * FROM fn_accounts_utilities_breakdown('2026-07-01','2026-07-31', NULL);
-- SELECT SUM(amount) AS total_utilities FROM fn_accounts_utilities_breakdown('2026-07-01','2026-07-31', NULL);
-- ============================================================
