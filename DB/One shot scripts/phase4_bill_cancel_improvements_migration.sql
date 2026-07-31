-- ============================================================
-- Kovilpatti Snacks — Phase 4b · CANCEL IMPROVEMENTS · MIGRATION
--
-- Feature #2 from DB/planned/phase4_billing_full_scope.md.
--   • Structured cancel reason: cancel_reason_type (category) alongside
--     the existing cancel_reason (free-text note).
--   • cancelled_by already captured by fn_bill_cancel.
--   • Manager-PIN gate + cancel slip (thermal): intentionally NOT built.
--
-- Idempotent one-shot. Baked into DB/phase4/phase4_billing_init.sql +
-- phase4_billing_procedures.sql for fresh deploys.
--
-- Run AFTER phase4_billing_init.sql + phase4_billing_procedures.sql.
-- ============================================================

BEGIN;

-- 1. Structured reason category on the header.
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS cancel_reason_type varchar(20);

ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_cancel_reason_type;
ALTER TABLE bills ADD  CONSTRAINT chk_bills_cancel_reason_type
  CHECK (cancel_reason_type IS NULL
         OR cancel_reason_type IN ('Mistake','Duplicate','CustomerRefused','Other'));

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- 3. fn_bill_cancel — whole-bill reversal with a reason category + note.
--    Drop the older signatures so no stale overload lingers.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar);
DROP FUNCTION IF EXISTS fn_bill_cancel(uuid, uuid, uuid, varchar, varchar, varchar);

CREATE OR REPLACE FUNCTION fn_bill_cancel(
  p_bill_id      uuid,
  p_shop_id      uuid,
  p_user_id      uuid,
  p_reason_type  varchar,
  p_reason_note  varchar DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_bill        record;
  v_line        record;
BEGIN
  IF p_reason_type NOT IN ('Mistake','Duplicate','CustomerRefused','Other') THEN
    RAISE EXCEPTION 'Please choose a valid cancellation reason.';
  END IF;

  SELECT b.id, b.code, b.status
  INTO v_bill
  FROM bills b
  WHERE b.id = p_bill_id AND b.shop_id = p_shop_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;

  IF v_bill.status = 'Cancelled' THEN
    RAISE EXCEPTION 'Bill % is already cancelled.', v_bill.code;
  END IF;

  FOR v_line IN
    SELECT bi.product_id, bi.qty FROM bill_items bi WHERE bi.bill_id = p_bill_id
  LOOP
    PERFORM fn_shop_inventory_refund(
      p_shop_id, v_line.product_id, v_line.qty, p_bill_id,
      'Cancel ' || v_bill.code || ': ' || p_reason_type, p_user_id
    );
  END LOOP;

  UPDATE bills b
  SET status             = 'Cancelled',
      cancelled_at       = now(),
      cancelled_by       = p_user_id,
      cancel_reason_type = p_reason_type,
      cancel_reason      = NULLIF(btrim(p_reason_note), ''),
      updated_by         = p_user_id
  WHERE b.id = p_bill_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. fn_bill_get + fn_bill_list — expose cancel_reason_type.
--    (Full bodies reproduced so the migration is self-contained.)
--    DROP first: adding columns changes the return type, which
--    CREATE OR REPLACE cannot do.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_bill_get(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_bill_get(
  p_bill_id  uuid,
  p_shop_id  uuid
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  total_amount       numeric,
  notes              varchar,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancelled_by_name  varchar,
  cancel_reason_type varchar,
  cancel_reason      varchar
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.notes,
         b.created_at,
         cu.full_name AS created_by_name,
         b.cancelled_at,
         xu.full_name AS cancelled_by_name,
         b.cancel_reason_type,
         b.cancel_reason
  FROM   bills b
  LEFT   JOIN users cu ON cu.id = b.created_by
  LEFT   JOIN users xu ON xu.id = b.cancelled_by
  WHERE  b.id = p_bill_id
    AND  b.shop_id = p_shop_id
    AND  b.is_deleted = false;
$$;

DROP FUNCTION IF EXISTS fn_bill_list(uuid, varchar, varchar, date, date, int, int);
CREATE OR REPLACE FUNCTION fn_bill_list(
  p_shop_id    uuid,
  p_search     varchar DEFAULT NULL,
  p_status     varchar DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 10
)
RETURNS TABLE (
  id                 uuid,
  code               varchar,
  status             varchar,
  payment_mode       varchar,
  total_items        int,
  total_qty          int,
  total_amount       numeric,
  created_at         timestamptz,
  created_by_name    varchar,
  cancelled_at       timestamptz,
  cancel_reason_type varchar,
  cancel_reason      varchar,
  total_count        bigint
)
LANGUAGE sql STABLE AS $$
  SELECT b.id,
         b.code,
         b.status,
         b.payment_mode,
         b.total_items,
         b.total_qty,
         b.total_amount,
         b.created_at,
         u.full_name AS created_by_name,
         b.cancelled_at,
         b.cancel_reason_type,
         b.cancel_reason,
         COUNT(*) OVER() AS total_count
  FROM   bills b
  LEFT   JOIN users u ON u.id = b.created_by
  WHERE  b.shop_id = p_shop_id
    AND  b.is_deleted = false
    AND  (p_status IS NULL OR p_status = '' OR b.status = p_status)
    AND  (p_search IS NULL OR p_search = '' OR b.code ILIKE '%' || p_search || '%')
    AND  (p_from IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND  (p_to   IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  ORDER  BY b.created_at DESC
  LIMIT  p_page_size
  OFFSET GREATEST(p_page - 1, 0) * p_page_size;
$$;


-- ============================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bills' AND column_name='cancel_reason_type';
-- ============================================================
