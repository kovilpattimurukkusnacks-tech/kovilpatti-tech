-- =====================================================================
-- phase4_shop_inventory_dev_revert.sql   (DEV / TESTING ONLY)
-- =====================================================================
-- Wipes every row from the Phase 4 shop-inventory tables and (optionally)
-- rewinds any recent "Received" stock_requests back to "Dispatched" so the
-- confirm-receipt hook can be tested from a clean slate as many times as
-- needed.
--
-- Scope of the wipe (Section A — always runs):
--   • shop_inventory              → truncated
--   • shop_inventory_movements    → truncated
--   • shop_stock_takes            → truncated (cascades to items)
--   • shop_stock_take_items       → truncated as a defensive belt-and-
--     braces after the cascade
--   • stock_take_code_seq         → restarted at 1
--
-- Section B (rewind stock_requests) is OPTIONAL — leave it commented if
-- you only want to clear the shop-inventory ledger and keep the request
-- lifecycle where it is. Uncomment when you want a "receive it again"
-- test with the same request row.
--
-- SAFETY:
--   • DO NOT run this against UAT / prod. It's data-destructive.
--   • Safe to re-run — every operation is idempotent.
--   • No effect on phase1 / phase2 / phase3 tables outside of the
--     optional Section B rewind block.
-- =====================================================================

BEGIN;


-- ============ Section A — nuke shop-inventory state ==================

-- Postgres allows a multi-table TRUNCATE without CASCADE when every
-- FK-referencing table is included in the same command. All 4 tables
-- are listed here (shop_stock_take_items has an FK to shop_stock_takes;
-- no other table references any of these), so CASCADE is deliberately
-- omitted. That way, if a future schema adds a table with an FK into
-- shop_inventory_movements (e.g. a bill_items linked to a Sale
-- movement), this script will FAIL LOUDLY instead of silently wiping
-- that new table's data. Fix would be: add the new table to this list.
TRUNCATE TABLE
  shop_inventory_movements,
  shop_inventory,
  shop_stock_take_items,
  shop_stock_takes
RESTART IDENTITY;

-- RESTART IDENTITY on TRUNCATE resets serial/identity columns, but NOT
-- explicitly-created sequences that supply DEFAULT values. Reset the
-- stock-take code counter so the next fn_stock_take_start() returns
-- STK0001 again on this dev DB.
ALTER SEQUENCE stock_take_code_seq RESTART WITH 1;


-- ============ Section B — rewind confirmed receipts (OPTIONAL) =======
-- Uncomment ONE of the three variants below depending on what you want
-- to re-test. Each variant is standalone; do not mix.

-- ─── Variant B1 — rewind ALL Received requests (system-wide) ────────
-- Aggressive: flips every 'Received' row back to 'Dispatched' and
-- clears its received_at / received_by / per-item received_qty. Use
-- when the whole dev DB is scratch data.
--
-- UPDATE stock_request_items sri
-- SET    received_qty = NULL
-- FROM   stock_requests sr
-- WHERE  sri.request_id = sr.id
--   AND  sr.status = 'Received'
--   AND  sr.is_deleted = false;
--
-- UPDATE stock_requests
-- SET    status      = 'Dispatched',
--        received_at = NULL,
--        received_by = NULL
-- WHERE  status = 'Received'
--   AND  is_deleted = false;


-- ─── Variant B2 — rewind Received requests received TODAY (IST) ─────
-- Safer: only flips today's receipts so historical data stays intact.
--
-- UPDATE stock_request_items sri
-- SET    received_qty = NULL
-- FROM   stock_requests sr
-- WHERE  sri.request_id = sr.id
--   AND  sr.status = 'Received'
--   AND  sr.is_deleted = false
--   AND  (sr.received_at AT TIME ZONE 'Asia/Kolkata')::date =
--        (now()          AT TIME ZONE 'Asia/Kolkata')::date;
--
-- UPDATE stock_requests
-- SET    status      = 'Dispatched',
--        received_at = NULL,
--        received_by = NULL
-- WHERE  status = 'Received'
--   AND  is_deleted = false
--   AND  (received_at AT TIME ZONE 'Asia/Kolkata')::date =
--        (now()       AT TIME ZONE 'Asia/Kolkata')::date;


-- ─── Variant B3 — rewind ONE specific request by code ───────────────
-- Most surgical: only touches the request you name. Change the code
-- literal to the REQ you're re-testing.
--
-- UPDATE stock_request_items sri
-- SET    received_qty = NULL
-- FROM   stock_requests sr
-- WHERE  sri.request_id = sr.id
--   AND  sr.code   = 'REQ0058'         -- ← change this
--   AND  sr.status = 'Received'
--   AND  sr.is_deleted = false;
--
-- UPDATE stock_requests
-- SET    status      = 'Dispatched',
--        received_at = NULL,
--        received_by = NULL
-- WHERE  code   = 'REQ0058'            -- ← change this
--   AND  status = 'Received'
--   AND  is_deleted = false;


COMMIT;


-- =====================================================================
-- VERIFY (paste after commit)
-- ---------------------------------------------------------------------
-- SELECT COUNT(*) FROM shop_inventory;                -- should be 0
-- SELECT COUNT(*) FROM shop_inventory_movements;      -- should be 0
-- SELECT COUNT(*) FROM shop_stock_takes;              -- should be 0
-- SELECT COUNT(*) FROM shop_stock_take_items;         -- should be 0
-- SELECT last_value, is_called FROM stock_take_code_seq;
--   -- is_called=false + last_value=1  → next STK code will be STK0001
--
-- If you ran Section B, confirm the rewind:
-- SELECT status, COUNT(*) FROM stock_requests
--  WHERE is_deleted = false GROUP BY status ORDER BY 1;
-- =====================================================================


-- =====================================================================
-- OPTIONAL — re-seed opening balances from historical dispatches after
-- the wipe. If you flipped everything back to 'Dispatched' via B1, you
-- don't need this (the next receive will populate on-hand naturally).
-- If you want a baseline of on-hand from PAST receipts (which are still
-- 'Received' in the DB), run this — it's idempotent, so re-runs skip
-- already-opened (shop, product) pairs.
--
-- SELECT * FROM fn_shop_inventory_seed_opening(NULL);
-- =====================================================================
