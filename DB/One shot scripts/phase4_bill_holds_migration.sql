-- ============================================================
-- Kovilpatti Snacks — Phase 4c · HELD (DRAFT) BILLS · MIGRATION
--
-- Feature #3 (Suspend/Hold). A cashier parks a bill mid-transaction,
-- serves another customer, and resumes later. A held bill is a
-- lightweight DRAFT — it does NOT consume stock and burns no bill code.
-- On resume the FE rebuilds the cart from CURRENT product data (fresh
-- MRP + on-hand) and the draft is deleted; finalising then goes through
-- the normal fn_bill_create (which is what consumes stock).
--
-- Kept separate from `bills` so the issued-bill table stays clean
-- (bills = real sales only; no half-finished rows, no stock/payment
-- semantics to bend).
--
-- Idempotent one-shot. Baked into DB/phase4 canonical files for fresh
-- deploys. Run AFTER phase4_billing_init.sql + phase4_customers_credit_migration.sql
-- (references customers).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS held_bills (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid          NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  customer_id  uuid          NULL REFERENCES customers(id) ON DELETE SET NULL,
  label        varchar(120)  NULL,   -- optional cashier note ("blue shirt uncle")
  note         varchar(500)  NULL,
  total_qty    int           NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   uuid          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  updated_by   uuid          REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_held_bills_shop ON held_bills(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS held_bill_items (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  held_bill_id  uuid  NOT NULL REFERENCES held_bills(id) ON DELETE CASCADE,
  product_id    uuid  NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty           int   NOT NULL,
  CONSTRAINT uq_held_bill_items_bill_product UNIQUE (held_bill_id, product_id),
  CONSTRAINT chk_held_bill_items_qty_pos CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_held_bill_items_bill ON held_bill_items(held_bill_id);

DROP TRIGGER IF EXISTS trg_held_bills_updated ON held_bills;
CREATE TRIGGER trg_held_bills_updated BEFORE UPDATE ON held_bills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ============================================================
-- PROCEDURES
-- ============================================================

-- ------------------------------------------------------------
-- fn_bill_hold_create — park a draft. No stock touched. Totals cached
-- from CURRENT MRP for the drawer display. p_items jsonb array of
-- {"productId": uuid, "qty": int}.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_create(
  p_shop_id      uuid,
  p_user_id      uuid,
  p_customer_id  uuid,
  p_label        varchar,
  p_note         varchar,
  p_items        jsonb
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id   uuid;
  v_line record;
  v_qty  int := 0;
  v_amt  numeric(12,2) := 0;
  v_mrp  numeric(10,2);
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nothing to hold — the bill is empty.';
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) <>
     (SELECT COUNT(DISTINCT x->>'productId') FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'The same product appears twice — adjust the quantity on one line instead.';
  END IF;

  INSERT INTO held_bills (shop_id, customer_id, label, note, created_by)
  VALUES (p_shop_id, p_customer_id, NULLIF(btrim(p_label), ''), NULLIF(btrim(p_note), ''), p_user_id)
  RETURNING id INTO v_id;

  FOR v_line IN
    SELECT (x->>'productId')::uuid AS product_id, (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be a positive whole number.';
    END IF;
    SELECT p.mrp INTO v_mrp FROM products p
    WHERE p.id = v_line.product_id AND p.is_deleted = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found.', v_line.product_id;
    END IF;

    INSERT INTO held_bill_items (held_bill_id, product_id, qty)
    VALUES (v_id, v_line.product_id, v_line.qty);

    v_qty := v_qty + v_line.qty;
    v_amt := v_amt + (v_line.qty * COALESCE(v_mrp, 0));
  END LOOP;

  UPDATE held_bills SET total_qty = v_qty, total_amount = v_amt WHERE id = v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_list — drafts for a shop, newest first.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_list(
  p_shop_id  uuid
)
RETURNS TABLE (
  id uuid, label varchar, note varchar, customer_name varchar,
  item_count int, total_qty int, total_amount numeric, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.label, h.note, c.name AS customer_name,
         (SELECT COUNT(*)::int FROM held_bill_items hi WHERE hi.held_bill_id = h.id) AS item_count,
         h.total_qty, h.total_amount, h.created_at
  FROM   held_bills h
  LEFT   JOIN customers c ON c.id = h.customer_id
  WHERE  h.shop_id = p_shop_id
  ORDER  BY h.created_at DESC;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_get — draft header (customer + label to restore).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_get(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, customer_id uuid, label varchar, note varchar
)
LANGUAGE sql STABLE AS $$
  SELECT h.id, h.customer_id, h.label, h.note
  FROM   held_bills h
  WHERE  h.id = p_held_bill_id AND h.shop_id = p_shop_id;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_get_items — items with CURRENT product data so the FE
-- can rebuild cart lines directly (fresh MRP + this shop's on-hand).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_get_items(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS TABLE (
  id uuid, code text, barcode varchar, name varchar,
  weight_value numeric, weight_unit varchar, mrp numeric, on_hand numeric, qty int
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.barcode, p.name, p.weight_value, p.weight_unit, p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand, hi.qty
  FROM   held_bill_items hi
  JOIN   held_bills h ON h.id = hi.held_bill_id AND h.shop_id = p_shop_id
  JOIN   products p   ON p.id = hi.product_id
  LEFT   JOIN shop_inventory si ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  hi.held_bill_id = p_held_bill_id
  ORDER  BY p.name;
$$;

-- ------------------------------------------------------------
-- fn_bill_hold_delete — discard a draft (also used after resume).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bill_hold_delete(
  p_held_bill_id  uuid,
  p_shop_id       uuid
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM held_bills WHERE id = p_held_bill_id AND shop_id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Held bill not found.';
  END IF;
END;
$$;


-- ============================================================
-- VERIFY
--   SELECT tablename FROM pg_tables WHERE tablename IN ('held_bills','held_bill_items');
-- ============================================================
