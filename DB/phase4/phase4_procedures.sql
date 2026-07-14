-- ============================================================
-- Kovilpatti Snacks — Phase 4 PROCEDURES (re-runnable, CREATE OR REPLACE)
--
-- Shop Utility / Operating Expenses SPs. All list/create/update/delete
-- calls take (or resolve to) a shop_id — the BE always passes the calling
-- ShopUser's own shop_id (from the JWT claim), never a client-supplied one.
--
-- Run AFTER phase4_init.sql.
-- ============================================================

-- ============== Shop Utility Expenses ============================

CREATE OR REPLACE FUNCTION fn_shop_utility_expense_list(
  p_shop_id   uuid,
  p_from_date date DEFAULT NULL,
  p_to_date   date DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  shop_id      uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.shop_id, e.category, e.amount, e.note, e.expense_date,
         e.created_at, e.updated_at
  FROM shop_utility_expenses e
  WHERE e.shop_id = p_shop_id
    AND e.is_deleted = false
    AND (p_from_date IS NULL OR e.expense_date >= p_from_date)
    AND (p_to_date   IS NULL OR e.expense_date <= p_to_date)
  ORDER BY e.expense_date DESC, e.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION fn_shop_utility_expense_get(p_id uuid)
RETURNS TABLE (
  id           uuid,
  shop_id      uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.shop_id, e.category, e.amount, e.note, e.expense_date,
         e.created_at, e.updated_at
  FROM shop_utility_expenses e
  WHERE e.id = p_id AND e.is_deleted = false
  LIMIT 1;
$$;

-- Return type changes from uuid → TABLE below, which CREATE OR REPLACE
-- can't do in place — drop the old signature first (idempotent / safe to
-- re-run: DROP IF EXISTS is a no-op once this has already been applied).
DROP FUNCTION IF EXISTS fn_shop_utility_expense_create(uuid, varchar, numeric, varchar, date, uuid);

-- Returns the full created row directly (via RETURNING) instead of just the
-- new id — the BE previously had to make a SECOND round trip (a follow-up
-- fn_shop_utility_expense_get call) just to build the response DTO. One
-- fewer network hop per Add Expense click.
CREATE OR REPLACE FUNCTION fn_shop_utility_expense_create(
  p_shop_id      uuid,
  p_category     varchar,
  p_amount       numeric,
  p_note         varchar,
  p_expense_date date,
  p_user_id      uuid
)
RETURNS TABLE (
  id           uuid,
  shop_id      uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql AS $$
  INSERT INTO shop_utility_expenses
    (shop_id, category, amount, note, expense_date, created_by, updated_by)
  VALUES
    (p_shop_id, p_category, p_amount, p_note, p_expense_date, p_user_id, p_user_id)
  RETURNING id, shop_id, category, amount, note, expense_date, created_at, updated_at;
$$;

-- Same round-trip-elimination as _create above — return type changes from
-- boolean → TABLE, so drop the old signature first.
DROP FUNCTION IF EXISTS fn_shop_utility_expense_update(uuid, varchar, numeric, varchar, date, uuid);

CREATE OR REPLACE FUNCTION fn_shop_utility_expense_update(
  p_id           uuid,
  p_category     varchar,
  p_amount       numeric,
  p_note         varchar,
  p_expense_date date,
  p_user_id      uuid
)
RETURNS TABLE (
  id           uuid,
  shop_id      uuid,
  category     varchar,
  amount       numeric,
  note         varchar,
  expense_date date,
  created_at   timestamptz,
  updated_at   timestamptz
)
LANGUAGE sql AS $$
  UPDATE shop_utility_expenses
  SET category     = p_category,
      amount       = p_amount,
      note         = p_note,
      expense_date = p_expense_date,
      updated_by   = p_user_id,
      updated_at   = now()
  WHERE id = p_id AND is_deleted = false
  RETURNING id, shop_id, category, amount, note, expense_date, created_at, updated_at;
$$;

CREATE OR REPLACE FUNCTION fn_shop_utility_expense_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shop_utility_expenses
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;
