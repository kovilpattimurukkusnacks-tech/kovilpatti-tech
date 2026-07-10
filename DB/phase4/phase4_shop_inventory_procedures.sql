-- ============================================================
-- Kovilpatti Snacks — Phase 4 · SHOP INVENTORY · PROCEDURES (SPs)
--
-- Companion to phase4_shop_inventory_init.sql. Contains all SPs for
-- the shop-inventory slice: core writer + named wrappers + opening
-- seed + read APIs + stock-take flow.
--
-- Run AFTER phase4_shop_inventory_init.sql. All functions use
-- CREATE OR REPLACE — safe to reload after edits without dropping.
-- ============================================================
--
-- HOW TO RUN
--   Supabase: paste in SQL Editor → Run.
--   Local PG: psql -U postgres -d sks_inventory -f phase4/phase4_shop_inventory_procedures.sql
-- ============================================================


-- ------------------------------------------------------------
-- 0. Core movement writer (internal helper)
--
-- Every change to shop_inventory.on_hand goes through here. It:
--   1. Ensures the (shop, product) row exists (creates a zero row if not).
--   2. Locks the row FOR UPDATE — prevents two cashiers from overselling
--      the same last packet in a race.
--   3. Rejects negative on_hand outcomes with a clear message that carries
--      the current state, so overselling surfaces as a 400 at the API
--      boundary rather than a silent negative row.
--   4. Recomputes avg_cost via weighted-average — ONLY on Receipt / Opening
--      movements that carry a unit_cost. Sales / Returns / Adjustments
--      preserve avg_cost so P&L stays honest.
--   5. Writes the ledger row with qty_after set to the new on_hand.
--
-- Callers: the named wrappers below (Receipt/Sale/Return/Refund/Adjustment)
-- + the stock-take submit flow + the bill / stock-request flows once those
-- SPs land in later Phase 4 slices.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_shop_inventory_apply_movement(
  p_shop_id       uuid,
  p_product_id    uuid,
  p_movement_type varchar,
  p_qty_delta     numeric,
  p_unit_cost     numeric DEFAULT NULL,
  p_ref_type      varchar DEFAULT 'ManualAdjustment',
  p_ref_id        uuid    DEFAULT NULL,
  p_note          text    DEFAULT NULL,
  p_created_by    uuid    DEFAULT NULL
)
RETURNS uuid  -- id of the movement row written
LANGUAGE plpgsql AS $$
DECLARE
  v_current_on_hand   numeric(12,3);
  v_current_avg_cost  numeric(10,2);
  v_new_on_hand       numeric(12,3);
  v_new_avg_cost      numeric(10,2);
  v_movement_id       uuid;
BEGIN
  INSERT INTO shop_inventory(shop_id, product_id, on_hand, avg_cost, updated_at)
  VALUES (p_shop_id, p_product_id, 0, 0, now())
  ON CONFLICT (shop_id, product_id) DO NOTHING;

  SELECT on_hand, avg_cost
  INTO v_current_on_hand, v_current_avg_cost
  FROM shop_inventory
  WHERE shop_id = p_shop_id AND product_id = p_product_id
  FOR UPDATE;

  v_new_on_hand := v_current_on_hand + p_qty_delta;

  IF v_new_on_hand < 0 THEN
    RAISE EXCEPTION 'shop_inventory would go negative: shop=% product=% current=% delta=%',
      p_shop_id, p_product_id, v_current_on_hand, p_qty_delta
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_movement_type IN ('Receipt', 'Opening'))
     AND p_unit_cost IS NOT NULL
     AND p_qty_delta > 0
     AND v_new_on_hand > 0 THEN
    v_new_avg_cost := (
      (v_current_on_hand * v_current_avg_cost) + (p_qty_delta * p_unit_cost)
    ) / v_new_on_hand;
  ELSE
    v_new_avg_cost := v_current_avg_cost;
  END IF;

  UPDATE shop_inventory
  SET on_hand          = v_new_on_hand,
      avg_cost         = v_new_avg_cost,
      last_movement_at = now(),
      updated_at       = now()
  WHERE shop_id = p_shop_id AND product_id = p_product_id;

  INSERT INTO shop_inventory_movements (
    shop_id, product_id, movement_type, qty_delta, qty_after,
    unit_cost, ref_type, ref_id, note, created_by
  )
  VALUES (
    p_shop_id, p_product_id, p_movement_type, p_qty_delta, v_new_on_hand,
    p_unit_cost, p_ref_type, p_ref_id, p_note, p_created_by
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;


-- ------------------------------------------------------------
-- 1. Named movement wrappers
--
-- Thin wrappers around fn_shop_inventory_apply_movement for the five
-- common cases. Callers can also invoke the core writer directly if
-- they need a movement_type / ref_type combo the wrappers don't cover.
-- ------------------------------------------------------------

-- Goods coming IN to the shop from a godown dispatch.
-- Called from the stock-request receive flow (once wired).
CREATE OR REPLACE FUNCTION fn_shop_inventory_receipt(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_unit_cost   numeric,
  p_ref_type    varchar,   -- typically 'StockRequest'
  p_ref_id      uuid,
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Receipt', abs(p_qty), p_unit_cost,
    p_ref_type, p_ref_id, p_note, p_created_by
  );
$$;

-- Sale to a walk-in customer. Called from fn_bill_create per line item
-- (once the bills SP lands). qty passed positive; wrapper negates.
CREATE OR REPLACE FUNCTION fn_shop_inventory_sale(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_ref_id      uuid,       -- bill_id
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Sale', -abs(p_qty), NULL,
    'Bill', p_ref_id, p_note, p_created_by
  );
$$;

-- Return — direction depends on caller:
--   • Customer returning to shop → positive qty (on_hand goes UP)
--   • Shop returning to godown  → negative qty (on_hand goes DOWN)
-- Caller passes the signed qty explicitly.
CREATE OR REPLACE FUNCTION fn_shop_inventory_return(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty_delta   numeric,    -- signed by caller
  p_ref_type    varchar,    -- 'StockRequest' (shop→godown) | 'BillReturn' (customer→shop)
  p_ref_id      uuid,
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Return', p_qty_delta, NULL,
    p_ref_type, p_ref_id, p_note, p_created_by
  );
$$;

-- Bill cancellation — reverses a Sale by putting goods back on the shelf.
-- Called from fn_bill_cancel (once the bills SP lands).
CREATE OR REPLACE FUNCTION fn_shop_inventory_refund(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty         numeric,
  p_ref_id      uuid,       -- bill_id being reversed
  p_note        text  DEFAULT NULL,
  p_created_by  uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Refund', abs(p_qty), NULL,
    'Bill', p_ref_id, p_note, p_created_by
  );
$$;

-- Manual admin correction (damaged, expired, mis-count found outside a
-- formal stock-take). qty_delta signed by caller.
CREATE OR REPLACE FUNCTION fn_shop_inventory_manual_adjustment(
  p_shop_id     uuid,
  p_product_id  uuid,
  p_qty_delta   numeric,
  p_reason      text,
  p_created_by  uuid
) RETURNS uuid
LANGUAGE sql AS $$
  SELECT fn_shop_inventory_apply_movement(
    p_shop_id, p_product_id, 'Adjustment', p_qty_delta, NULL,
    'ManualAdjustment', NULL, p_reason, p_created_by
  );
$$;


-- ------------------------------------------------------------
-- 2. Opening seed
--
-- Rolls up historical stock_request_items.received_qty per (shop, product)
-- and writes one Opening movement + populates initial on_hand + avg_cost.
--
-- Pass NULL to seed ALL shops; pass a specific shop_id to scope.
-- Idempotent — skips pairs that already have an Opening row.
--
-- Only movements where the shop actually received goods count
-- (stock_requests.status IN ('Received', 'Dispatched')).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_shop_inventory_seed_opening(
  p_shop_id uuid DEFAULT NULL
)
RETURNS TABLE (
  shop_id    uuid,
  product_id uuid,
  seeded_qty numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_row             record;
  v_purchase_price  numeric(10,2);
BEGIN
  FOR v_row IN
    SELECT
      sr.shop_id     AS s_id,
      sri.product_id AS p_id,
      SUM(COALESCE(sri.received_qty, 0))::numeric AS total_received
    FROM stock_request_items sri
    INNER JOIN stock_requests sr ON sr.id = sri.request_id
    WHERE sr.status IN ('Received', 'Dispatched')
      AND (p_shop_id IS NULL OR sr.shop_id = p_shop_id)
      AND COALESCE(sri.received_qty, 0) > 0
    GROUP BY sr.shop_id, sri.product_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM shop_inventory_movements
      WHERE shop_inventory_movements.shop_id = v_row.s_id
        AND shop_inventory_movements.product_id = v_row.p_id
        AND movement_type = 'Opening'
    ) THEN
      CONTINUE;
    END IF;

    SELECT purchase_price INTO v_purchase_price
    FROM products WHERE id = v_row.p_id;

    PERFORM fn_shop_inventory_apply_movement(
      v_row.s_id, v_row.p_id,
      'Opening', v_row.total_received,
      COALESCE(v_purchase_price, 0),
      'Opening', NULL,
      'Initial seed from historical dispatch receipts',
      NULL
    );

    shop_id    := v_row.s_id;
    product_id := v_row.p_id;
    seeded_qty := v_row.total_received;
    RETURN NEXT;
  END LOOP;
END;
$$;


-- ------------------------------------------------------------
-- 3. Read APIs (public — surface as endpoints)
-- ------------------------------------------------------------

-- Standing on-hand for a shop with optional tokenised search over
-- product code + name. Same predicate as fn_product_list — see
-- phase1_product_tokenized_search.sql for rationale (handles
-- "nat.kam" / "nat kam" / "017 kam" / etc).
CREATE OR REPLACE FUNCTION fn_shop_inventory_on_hand(
  p_shop_id     uuid,
  p_search      varchar DEFAULT NULL,
  p_page        int     DEFAULT 1,
  p_page_size   int     DEFAULT 25
)
RETURNS TABLE (
  product_id        uuid,
  product_code      text,
  product_name      varchar,
  category_name     varchar,
  weight_value      numeric,
  weight_unit       varchar,
  mrp               numeric,
  on_hand           numeric,
  avg_cost          numeric,
  stock_value       numeric,
  last_movement_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.code, p.name, c.name AS category_name,
    p.weight_value, p.weight_unit, p.mrp,
    si.on_hand, si.avg_cost,
    (si.on_hand * si.avg_cost)::numeric(14,2) AS stock_value,
    si.last_movement_at
  FROM shop_inventory si
  INNER JOIN products   p ON p.id = si.product_id
  INNER JOIN categories c ON c.id = p.category_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ))
  ORDER BY p.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Total row count matching the same filter — pagination needs both.
CREATE OR REPLACE FUNCTION fn_shop_inventory_on_hand_count(
  p_shop_id uuid,
  p_search  varchar DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND (p_search IS NULL OR trim(p_search) = ''
         OR NOT EXISTS (
           SELECT 1
           FROM regexp_split_to_table(lower(trim(p_search)), '[^a-z0-9]+') AS tok
           WHERE tok <> ''
             AND strpos(lower(p.code || ' ' || p.name), tok) = 0
         ));
$$;

-- Single (shop, product) row lookup.
CREATE OR REPLACE FUNCTION fn_shop_inventory_get(
  p_shop_id    uuid,
  p_product_id uuid
)
RETURNS TABLE (
  shop_id           uuid,
  product_id        uuid,
  product_code      text,
  product_name      varchar,
  on_hand           numeric,
  avg_cost          numeric,
  stock_value       numeric,
  last_movement_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    si.shop_id, si.product_id,
    p.code, p.name,
    si.on_hand, si.avg_cost,
    (si.on_hand * si.avg_cost)::numeric(14,2) AS stock_value,
    si.last_movement_at
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id AND si.product_id = p_product_id
  LIMIT 1;
$$;

-- Reorder-suggestion feed.
CREATE OR REPLACE FUNCTION fn_shop_inventory_low_stock(
  p_shop_id   uuid,
  p_threshold numeric DEFAULT 5
)
RETURNS TABLE (
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  on_hand       numeric,
  mrp           numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, si.on_hand, p.mrp
  FROM shop_inventory si
  INNER JOIN products p ON p.id = si.product_id
  WHERE si.shop_id = p_shop_id
    AND p.is_deleted = false
    AND p.active = true
    AND si.on_hand < p_threshold
  ORDER BY si.on_hand ASC, p.code;
$$;

-- Balance-sheet inventory value = SUM(on_hand × avg_cost).
CREATE OR REPLACE FUNCTION fn_shop_inventory_valuation(
  p_shop_id uuid
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(on_hand * avg_cost), 0)::numeric(14,2)
  FROM shop_inventory
  WHERE shop_id = p_shop_id;
$$;

-- Movement audit trail — full ledger with product + actor names joined.
CREATE OR REPLACE FUNCTION fn_shop_inventory_movements(
  p_shop_id    uuid,
  p_product_id uuid    DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_page       int     DEFAULT 1,
  p_page_size  int     DEFAULT 50
)
RETURNS TABLE (
  id               uuid,
  product_id       uuid,
  product_code     text,
  product_name     varchar,
  movement_type    varchar,
  qty_delta        numeric,
  qty_after        numeric,
  unit_cost        numeric,
  ref_type         varchar,
  ref_id           uuid,
  note             text,
  created_at       timestamptz,
  created_by       uuid,
  created_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id, m.product_id, p.code, p.name,
    m.movement_type, m.qty_delta, m.qty_after,
    m.unit_cost, m.ref_type, m.ref_id, m.note,
    m.created_at, m.created_by, u.full_name
  FROM shop_inventory_movements m
  INNER JOIN products p ON p.id = m.product_id
  LEFT  JOIN users    u ON u.id = m.created_by
  WHERE m.shop_id = p_shop_id
    AND (p_product_id IS NULL OR m.product_id = p_product_id)
    AND (p_from IS NULL OR m.created_at >= p_from::timestamptz)
    AND (p_to   IS NULL OR m.created_at <  (p_to + interval '1 day')::timestamptz)
  ORDER BY m.created_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Movement summary bucketed by movement_type for a period.
CREATE OR REPLACE FUNCTION fn_shop_inventory_movement_summary(
  p_shop_id uuid,
  p_from    date,
  p_to      date
)
RETURNS TABLE (
  movement_type  varchar,
  total_qty      numeric,
  total_lines    bigint,
  total_value    numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.movement_type,
    SUM(m.qty_delta)::numeric AS total_qty,
    COUNT(*)                  AS total_lines,
    COALESCE(SUM(m.qty_delta * m.unit_cost), 0)::numeric(14,2) AS total_value
  FROM shop_inventory_movements m
  WHERE m.shop_id = p_shop_id
    AND m.created_at >= p_from::timestamptz
    AND m.created_at <  (p_to + interval '1 day')::timestamptz
  GROUP BY m.movement_type
  ORDER BY m.movement_type;
$$;


-- ------------------------------------------------------------
-- 4. Stock-take SPs
-- ------------------------------------------------------------

-- Start a Draft session. Snapshots every product currently in
-- shop_inventory with counted_qty = system_qty (so user adjusts what's
-- off, not re-enters everything).
CREATE OR REPLACE FUNCTION fn_stock_take_start(
  p_shop_id    uuid,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM shop_stock_takes
    WHERE shop_id = p_shop_id AND status = 'Draft' AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'A draft stock-take is already open for this shop'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO shop_stock_takes (shop_id, created_by)
  VALUES (p_shop_id, p_created_by)
  RETURNING id INTO v_id;

  INSERT INTO shop_stock_take_items (stock_take_id, product_id, system_qty, counted_qty)
  SELECT v_id, si.product_id, si.on_hand, si.on_hand
  FROM shop_inventory si
  WHERE si.shop_id = p_shop_id;

  RETURN v_id;
END;
$$;

-- Upsert one counted-qty line. If the product wasn't in the initial
-- snapshot (received AFTER Start), system_qty is fetched fresh
-- (0 if never received).
CREATE OR REPLACE FUNCTION fn_stock_take_upsert_line(
  p_stock_take_id uuid,
  p_product_id    uuid,
  p_counted_qty   numeric,
  p_note          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_shop_id    uuid;
  v_status     varchar;
  v_system_qty numeric;
BEGIN
  SELECT shop_id, status INTO v_shop_id, v_status
  FROM shop_stock_takes WHERE id = p_stock_take_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_stock_take_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'Draft' THEN
    RAISE EXCEPTION 'Cannot edit a % stock-take', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT on_hand INTO v_system_qty
  FROM shop_inventory
  WHERE shop_id = v_shop_id AND product_id = p_product_id;
  v_system_qty := COALESCE(v_system_qty, 0);

  INSERT INTO shop_stock_take_items (
    stock_take_id, product_id, system_qty, counted_qty, note
  )
  VALUES (p_stock_take_id, p_product_id, v_system_qty, p_counted_qty, p_note)
  ON CONFLICT (stock_take_id, product_id) DO UPDATE
    SET counted_qty = EXCLUDED.counted_qty,
        note        = EXCLUDED.note;
END;
$$;

-- Session detail — header + items joined. LEFT JOIN + NULLS LAST so a
-- freshly-started take with 0 lines still returns 1 row (header info).
CREATE OR REPLACE FUNCTION fn_stock_take_get(p_id uuid)
RETURNS TABLE (
  id            uuid,
  code          varchar,
  shop_id       uuid,
  status        varchar,
  started_at    timestamptz,
  submitted_at  timestamptz,
  notes         text,
  product_id    uuid,
  product_code  text,
  product_name  varchar,
  system_qty    numeric,
  counted_qty   numeric,
  qty_diff      numeric,
  item_note     text
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id, t.code, t.shop_id, t.status, t.started_at, t.submitted_at, t.notes,
    i.product_id, p.code, p.name,
    i.system_qty, i.counted_qty, i.qty_diff, i.note
  FROM shop_stock_takes t
  LEFT JOIN shop_stock_take_items i ON i.stock_take_id = t.id
  LEFT JOIN products p ON p.id = i.product_id
  WHERE t.id = p_id
  ORDER BY p.code NULLS LAST;
$$;

-- History list per shop with rollups: how many lines counted, how many
-- had a non-zero diff, and net diff qty (sanity signal — huge net means
-- someone counted wrong or there's genuine shrinkage).
CREATE OR REPLACE FUNCTION fn_stock_take_list(
  p_shop_id   uuid,
  p_status    varchar DEFAULT NULL,
  p_from      date    DEFAULT NULL,
  p_to        date    DEFAULT NULL,
  p_page      int     DEFAULT 1,
  p_page_size int     DEFAULT 25
)
RETURNS TABLE (
  id            uuid,
  code          varchar,
  status        varchar,
  started_at    timestamptz,
  submitted_at  timestamptz,
  item_count    bigint,
  diff_count    bigint,
  net_diff_qty  numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id, t.code, t.status, t.started_at, t.submitted_at,
    COUNT(i.id) FILTER (WHERE i.qty_diff IS NOT NULL) AS item_count,
    COUNT(i.id) FILTER (WHERE i.qty_diff <> 0)        AS diff_count,
    COALESCE(SUM(i.qty_diff), 0)::numeric             AS net_diff_qty
  FROM shop_stock_takes t
  LEFT JOIN shop_stock_take_items i ON i.stock_take_id = t.id
  WHERE t.shop_id = p_shop_id
    AND t.is_deleted = false
    AND (p_status IS NULL OR t.status = p_status)
    AND (p_from IS NULL OR t.started_at >= p_from::timestamptz)
    AND (p_to   IS NULL OR t.started_at <  (p_to + interval '1 day')::timestamptz)
  GROUP BY t.id
  ORDER BY t.started_at DESC
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- Commit the count → writes one Adjustment movement per non-zero diff
-- and marks the session Submitted. Returns count of movements written
-- so caller can show "N stock corrections applied".
CREATE OR REPLACE FUNCTION fn_stock_take_submit(
  p_id           uuid,
  p_submitted_by uuid
)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_shop_id  uuid;
  v_status   varchar;
  v_count    bigint := 0;
  v_row      record;
BEGIN
  SELECT shop_id, status INTO v_shop_id, v_status
  FROM shop_stock_takes WHERE id = p_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'Draft' THEN
    RAISE EXCEPTION 'Cannot submit a % stock-take', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN
    SELECT product_id, qty_diff
    FROM shop_stock_take_items
    WHERE stock_take_id = p_id AND qty_diff <> 0
  LOOP
    PERFORM fn_shop_inventory_apply_movement(
      v_shop_id, v_row.product_id,
      'Adjustment', v_row.qty_diff, NULL,
      'StockTake', p_id,
      'Stock-take reconciliation',
      p_submitted_by
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE shop_stock_takes
  SET status       = 'Submitted',
      submitted_at = now(),
      updated_at   = now(),
      updated_by   = p_submitted_by
  WHERE id = p_id;

  RETURN v_count;
END;
$$;

-- Cancel a Draft session — no movements written; reason appended to notes.
CREATE OR REPLACE FUNCTION fn_stock_take_cancel(
  p_id           uuid,
  p_reason       text,
  p_cancelled_by uuid
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status varchar;
BEGIN
  SELECT status INTO v_status
  FROM shop_stock_takes WHERE id = p_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Stock-take % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status = 'Submitted' THEN
    RAISE EXCEPTION 'Cannot cancel a submitted stock-take'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE shop_stock_takes
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason,
      updated_at = now(),
      updated_by = p_cancelled_by
  WHERE id = p_id;
END;
$$;


-- ============================================================
-- OPTIONAL — run the opening seed after this file commits.
-- Uncomment the appropriate line, paste into the SQL editor.
-- Safe to re-run — idempotent (skips pairs already opened).
--
--   SELECT * FROM fn_shop_inventory_seed_opening(NULL);
--   SELECT * FROM fn_shop_inventory_seed_opening('<shop-uuid-here>'::uuid);
-- ============================================================


-- ============================================================
-- QUICK VERIFY (paste each block after running both files;
-- adjust UUIDs to real shops / products / users in your dev DB)
-- ============================================================
--
-- Confirm SPs landed:
--   SELECT proname FROM pg_proc
--    WHERE proname LIKE 'fn_shop_inventory%' OR proname LIKE 'fn_stock_take%'
--    ORDER BY proname;
--
-- Record a receipt (godown → shop delivered 20 units @ ₹15):
--   SELECT fn_shop_inventory_receipt(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     20, 15.00, 'StockRequest', NULL, 'test receipt', NULL);
--
-- Peek at on-hand:
--   SELECT * FROM fn_shop_inventory_on_hand('<shop-uuid>'::uuid, NULL, 1, 25);
--
-- Peek at the ledger:
--   SELECT * FROM fn_shop_inventory_movements('<shop-uuid>'::uuid, NULL, NULL, NULL, 1, 20);
--
-- Ring up a sale (bill uuid is fake for the test):
--   SELECT fn_shop_inventory_sale(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     3, gen_random_uuid(), 'test sale', NULL);
--
-- Try to oversell — should raise check_violation:
--   SELECT fn_shop_inventory_sale(
--     '<shop-uuid>'::uuid, '<product-uuid>'::uuid,
--     9999, gen_random_uuid(), NULL, NULL);
--
-- Stock-take round-trip:
--   SELECT fn_stock_take_start('<shop-uuid>'::uuid, '<user-uuid>'::uuid);
--   SELECT fn_stock_take_upsert_line('<stock-take-id>'::uuid, '<product-uuid>'::uuid, 15, 'counted');
--   SELECT * FROM fn_stock_take_get('<stock-take-id>'::uuid);
--   SELECT fn_stock_take_submit('<stock-take-id>'::uuid, '<user-uuid>'::uuid);
--   SELECT * FROM fn_shop_inventory_movements('<shop-uuid>'::uuid, NULL, NULL, NULL, 1, 20);
--
-- Balance-sheet value + low stock:
--   SELECT fn_shop_inventory_valuation('<shop-uuid>'::uuid);
--   SELECT * FROM fn_shop_inventory_low_stock('<shop-uuid>'::uuid, 5);
-- ============================================================
