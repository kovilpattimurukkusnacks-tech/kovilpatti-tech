-- ============================================================
-- Kovilpatti Snacks — ACCOUNTS DASHBOARD SEED (May 2026)
--
-- Generates a month of realistic stock-request activity so the
-- /admin/accounts page (Phase 3) has data to render against.
--
-- WHAT IT CREATES
--   • 5 shops × 31 days = 155 requests dated May 1-31, 2026.
--   • ~85% Orders (status='Received'), ~15% Returns (status='Accepted').
--   • Each request: 50-75 line items sampled randomly from the
--     product catalogue.
--   • Dispatched / accepted qty per item is varied:
--       40% exact match to requested
--       30% OVER-delivered (req_qty + 1-3)
--       30% UNDER-delivered (req_qty - 1-3, floored at 0)
--     → mixed shortfall / overage so accounts adjustments matter.
--
-- IDEMPOTENT — skipped if any May-2026 request already exists
-- for the 5 target shops.
--
-- PREREQUISITES
--   • Catalogue loaded (phase1_seed_full_catalogue.sql or your own).
--   • At least 5 shops, each with a shop_user account, mapped to
--     at least 1 inventory. (Local matches: 5 shops, 5 users, 1 inv.)
--   • At least one user with role='inventory' OR an admin (used for
--     approved_by / dispatched_by / accepted_by). Falls back to admin.
-- ============================================================

BEGIN;

DO $do$
DECLARE
  v_admin_id    uuid;
  v_inv_user    uuid;
  v_shops       uuid[];     -- 5 shop ids (parallel to v_shop_users)
  v_shop_users  uuid[];     -- 5 shop_user ids
  v_shop_invs   uuid[];     -- 5 inventory_ids (per-shop mapping)

  v_existing    int;
  v_shop_count  int;

  v_shop_idx    int;
  v_day_idx     int;
  v_shop_id     uuid;
  v_shop_user   uuid;
  v_inv_id      uuid;
  v_submit_ts   timestamptz;
  v_is_return   boolean;
  v_item_count  int;
  v_request_id  uuid;
  v_code        varchar;

  v_total_orders   int := 0;
  v_total_returns  int := 0;
BEGIN
  ------------------------------------------------------------------
  -- 0. Admin + inventory user lookup.
  ------------------------------------------------------------------
  SELECT id INTO v_admin_id
  FROM users
  WHERE role = 'admin' AND is_deleted = false
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — start the BE once first.';
  END IF;

  -- First inventory_user; fall back to admin so a single-inv local
  -- deployment without a dedicated inv user still works.
  SELECT id INTO v_inv_user
  FROM users
  WHERE role = 'inventory' AND is_deleted = false
  ORDER BY created_at
  LIMIT 1;
  IF v_inv_user IS NULL THEN
    v_inv_user := v_admin_id;
  END IF;

  ------------------------------------------------------------------
  -- 1. Pick 5 shops + their assigned inventory + one shop_user each.
  ------------------------------------------------------------------
  WITH ranked_shops AS (
    SELECT id, inventory_id, code,
           ROW_NUMBER() OVER (ORDER BY code) AS rn
    FROM shops
    WHERE is_deleted = false
  ),
  -- DISTINCT ON works for uuid (MIN(uuid) is not defined in stock PG).
  shop_user_pick AS (
    SELECT DISTINCT ON (shop_id) shop_id, id AS user_id
    FROM users
    WHERE role = 'shop_user' AND is_deleted = false
    ORDER BY shop_id, created_at
  ),
  combined AS (
    SELECT r.id AS shop_id, r.inventory_id, sup.user_id, r.code
    FROM ranked_shops r
    LEFT JOIN shop_user_pick sup ON sup.shop_id = r.id
    WHERE r.rn <= 5
  )
  SELECT array_agg(shop_id        ORDER BY code),
         array_agg(COALESCE(user_id, v_admin_id) ORDER BY code),
         array_agg(inventory_id   ORDER BY code)
    INTO v_shops, v_shop_users, v_shop_invs
  FROM combined;

  v_shop_count := COALESCE(array_length(v_shops, 1), 0);
  IF v_shop_count < 5 THEN
    RAISE EXCEPTION 'Need at least 5 shops, found %.', v_shop_count;
  END IF;

  ------------------------------------------------------------------
  -- 2. Idempotency guard — skip if any May-2026 request already
  --    exists for these 5 shops.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_existing
  FROM stock_requests
  WHERE shop_id = ANY(v_shops)
    AND submitted_at >= '2026-05-01'::timestamptz
    AND submitted_at <  '2026-06-01'::timestamptz
    AND is_deleted = false;

  IF v_existing > 0 THEN
    RAISE NOTICE 'May-2026 requests already seeded (% rows) — skipping.', v_existing;
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- 3. Generate — 5 shops × 31 days.
  ------------------------------------------------------------------
  FOR v_shop_idx IN 1..v_shop_count LOOP
    v_shop_id   := v_shops[v_shop_idx];
    v_shop_user := v_shop_users[v_shop_idx];
    v_inv_id    := v_shop_invs[v_shop_idx];

    FOR v_day_idx IN 1..31 LOOP
      -- Submitted timestamp — that day, random business hour 09:00-17:59 IST.
      v_submit_ts := ('2026-05-' || lpad(v_day_idx::text, 2, '0') || ' 00:00:00')::timestamptz
                     + (9  + floor(random() * 9))::int  * interval '1 hour'
                     + floor(random() * 60)::int        * interval '1 minute';

      -- ~15% Returns, ~85% Orders. Returns become Accepted; Orders → Received.
      v_is_return  := (random() < 0.15);
      v_item_count := 50 + floor(random() * 26)::int;   -- 50..75
      v_code       := fn_request_next_code();

      ----------------------------------------------------------
      -- Insert the stock_request header. Branch on Order vs
      -- Return so the right audit timestamps populate.
      ----------------------------------------------------------
      IF v_is_return THEN
        INSERT INTO stock_requests (
          code, shop_id, inventory_id, status, request_type,
          editable_until,
          submitted_at, accepted_at,
          accepted_by, created_by, updated_by
        ) VALUES (
          v_code, v_shop_id, v_inv_id, 'Accepted', 'Return',
          v_submit_ts + interval '100 years',           -- Returns lock-window: irrelevant
          v_submit_ts,
          v_submit_ts + interval '2 hours' + (floor(random()*60))::int * interval '1 minute',
          v_inv_user, v_shop_user, v_inv_user
        ) RETURNING id INTO v_request_id;
        v_total_returns := v_total_returns + 1;
      ELSE
        INSERT INTO stock_requests (
          code, shop_id, inventory_id, status, request_type,
          editable_until,
          submitted_at, approved_at, approved_by,
          dispatched_at, dispatched_by,
          received_at, received_by,
          created_by, updated_by
        ) VALUES (
          v_code, v_shop_id, v_inv_id, 'Received', 'Order',
          v_submit_ts + interval '1 day',
          v_submit_ts,
          v_submit_ts + interval '30 minutes', v_inv_user,
          v_submit_ts + interval '2 hours',    v_inv_user,
          v_submit_ts + interval '5 hours',    v_shop_user,
          v_shop_user, v_inv_user
        ) RETURNING id INTO v_request_id;
        v_total_orders := v_total_orders + 1;
      END IF;

      ----------------------------------------------------------
      -- Insert line items. Random product sample, random qty,
      -- 3-way dispatched outcome (exact / over / under).
      ----------------------------------------------------------
      WITH sampled AS (
        SELECT p.id      AS product_id,
               p.mrp     AS unit_price,
               p.weight_value,
               p.weight_unit
        FROM products p
        WHERE p.is_deleted = false AND p.active = true
        ORDER BY random()
        LIMIT v_item_count
      ),
      with_qty AS (
        SELECT product_id, unit_price, weight_value, weight_unit,
               (1 + floor(random() * 12))::int AS req_qty,
               random()                        AS dispatch_roll,
               (1 + floor(random() * 3))::int  AS delta  -- magnitude of over/under
        FROM sampled
      )
      INSERT INTO stock_request_items (
        request_id, product_id, requested_qty, dispatched_qty,
        unit_price, weight_value, weight_unit
      )
      SELECT
        v_request_id,
        product_id,
        req_qty,
        CASE
          WHEN dispatch_roll < 0.40 THEN req_qty               -- 40% exact
          WHEN dispatch_roll < 0.70 THEN req_qty + delta       -- 30% OVER
          ELSE GREATEST(0, req_qty - delta)                    -- 30% UNDER (floored at 0)
        END,
        unit_price,
        weight_value,
        weight_unit
      FROM with_qty;

      ----------------------------------------------------------
      -- Refresh header cached totals from the items just inserted.
      -- (The SPs do this in production; we replicate here for the
      -- direct INSERT path.)
      ----------------------------------------------------------
      UPDATE stock_requests sr
      SET total_items  = agg.cnt,
          total_qty    = agg.qty,
          total_amount = agg.amt
      FROM (
        SELECT count(*) AS cnt,
               SUM(requested_qty)::int                AS qty,
               SUM(requested_qty * unit_price)::numeric(12,2) AS amt
        FROM stock_request_items
        WHERE request_id = v_request_id
      ) agg
      WHERE sr.id = v_request_id;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seed complete — % Orders + % Returns across 5 shops × 31 days.',
               v_total_orders, v_total_returns;

  ------------------------------------------------------------------
  -- 4. Admin's post-completion qty adjustments (client #9).
  --    Simulates the monthly review where admin reconciles 10% of
  --    delivered/accepted lines — some bumped UP (found extras in
  --    storage, miscounted), some bumped DOWN (overstated dispatch,
  --    shop returned partial). Each change writes a row to
  --    stock_request_qty_audits so Phase 3 accounts has adjustment
  --    history to consume.
  --
  --    edited_by = admin (only admin can do this in production).
  --    edited_at = 1-7 days after the request was closed, so the
  --    timeline is realistic for a "monthly reconciliation pass".
  ------------------------------------------------------------------
  WITH chosen AS MATERIALIZED (
    -- Sample ~10% of items from May-2026 Received/Accepted requests.
    -- MATERIALIZED prevents Postgres re-evaluating random() multiple
    -- times across joins, which would desync the same row across CTEs.
    SELECT
      it.id                                AS item_id,
      it.request_id                        AS request_id,
      it.dispatched_qty                    AS old_qty,
      CASE
        WHEN random() < 0.5
          THEN it.dispatched_qty + (1 + floor(random() * 3))::int      -- bump UP
        ELSE GREATEST(0, it.dispatched_qty - (1 + floor(random() * 3))::int)  -- bump DOWN, floor at 0
      END                                  AS new_qty,
      COALESCE(r.received_at, r.accepted_at)
        + interval '1 day' * (1 + floor(random() * 7))::int
        + floor(random() * 24)::int * interval '1 hour'                AS edited_at,
      -- Plausible admin notes — picked from a small bank.
      (ARRAY[
        'Counted wrong at dispatch',
        'Reconciled with shop count',
        'Found extra in storage',
        'Shop returned partial after delivery',
        'Inventory recount adjustment',
        'Damaged goods deducted',
        'End-of-month reconciliation'
      ])[1 + floor(random() * 7)::int]      AS reason
    FROM stock_request_items it
    JOIN stock_requests       r  ON r.id = it.request_id
    WHERE r.submitted_at >= '2026-05-01'::timestamptz
      AND r.submitted_at <  '2026-06-01'::timestamptz
      AND r.status IN ('Received', 'Accepted')
      AND r.is_deleted = false
      AND random() < 0.10
  ),
  -- Drop the rare case where new_qty == old_qty (happens when old was
  -- already 0 and we tried to subtract). The audit CHECK rejects same-value.
  distinct_changes AS MATERIALIZED (
    SELECT * FROM chosen WHERE new_qty IS DISTINCT FROM old_qty
  ),
  applied AS (
    -- Apply the new dispatched_qty in place. RETURNING surfaces the row
    -- so the audit INSERT below has everything it needs without a re-join.
    UPDATE stock_request_items it
    SET    dispatched_qty = dc.new_qty
    FROM   distinct_changes dc
    WHERE  it.id = dc.item_id
    RETURNING it.id, dc.old_qty, dc.new_qty, dc.request_id, dc.reason, dc.edited_at
  ),
  audit_inserts AS (
    INSERT INTO stock_request_qty_audits (
      request_item_id, request_id, old_qty, new_qty, reason, edited_by, edited_at
    )
    SELECT id, request_id, old_qty, new_qty, reason, v_admin_id, edited_at
    FROM   applied
    RETURNING 1
  )
  SELECT count(*) INTO v_existing FROM audit_inserts;

  -- Touch each affected request's updated_by/updated_at so the BE
  -- detail page picks up the change via its existing cache invalidation.
  UPDATE stock_requests sr
  SET    updated_by = v_admin_id
  WHERE  sr.id IN (
    SELECT DISTINCT request_id FROM stock_request_qty_audits
    WHERE edited_at >= '2026-05-01'::timestamptz
  );

  RAISE NOTICE 'Admin adjustments — % qty edits logged to stock_request_qty_audits.', v_existing;
END $do$;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- -- Daily request count, by type
-- SELECT date_trunc('day', submitted_at)::date AS day,
--        request_type, count(*) AS n,
--        SUM(total_amount) AS total_amt
-- FROM stock_requests
-- WHERE submitted_at >= '2026-05-01' AND submitted_at < '2026-06-01'
-- GROUP BY day, request_type
-- ORDER BY day, request_type;
--
-- -- Per-shop totals for the month
-- SELECT s.code, s.name,
--        count(*) FILTER (WHERE r.request_type = 'Order')  AS orders,
--        count(*) FILTER (WHERE r.request_type = 'Return') AS returns,
--        SUM(r.total_qty) AS total_qty,
--        SUM(r.total_amount) AS total_amt
-- FROM stock_requests r
-- JOIN shops s ON s.id = r.shop_id
-- WHERE r.submitted_at >= '2026-05-01' AND r.submitted_at < '2026-06-01'
-- GROUP BY s.code, s.name
-- ORDER BY s.code;
--
-- -- Distribution check: how often did we over / under / exact-deliver?
-- SELECT
--   CASE
--     WHEN dispatched_qty = requested_qty THEN 'exact'
--     WHEN dispatched_qty > requested_qty THEN 'over'
--     ELSE 'under'
--   END AS bucket,
--   count(*)
-- FROM stock_request_items it
-- JOIN stock_requests r ON r.id = it.request_id
-- WHERE r.submitted_at >= '2026-05-01' AND r.submitted_at < '2026-06-01'
-- GROUP BY bucket;
--
-- -- Admin qty-edit audit log (client #9)
-- SELECT count(*) AS total_edits,
--        count(*) FILTER (WHERE new_qty > old_qty) AS bumped_up,
--        count(*) FILTER (WHERE new_qty < old_qty) AS bumped_down,
--        MIN(edited_at) AS first_edit,
--        MAX(edited_at) AS last_edit
-- FROM stock_request_qty_audits
-- WHERE edited_at >= '2026-05-01';
--
-- -- Sample 20 audit rows with the linked product
-- SELECT a.edited_at, p.code, p.name, a.old_qty, a.new_qty,
--        a.new_qty - a.old_qty AS delta, a.reason
-- FROM stock_request_qty_audits a
-- JOIN stock_request_items   it ON it.id = a.request_item_id
-- JOIN products              p  ON p.id  = it.product_id
-- WHERE a.edited_at >= '2026-05-01'
-- ORDER BY a.edited_at
-- LIMIT 20;
-- ============================================================
-- ROLLBACK — wipe just the May-2026 seed
-- ============================================================
-- BEGIN;
-- DELETE FROM stock_requests
-- WHERE submitted_at >= '2026-05-01' AND submitted_at < '2026-06-01';
-- COMMIT;
-- ============================================================
