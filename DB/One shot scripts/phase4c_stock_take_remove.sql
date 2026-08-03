-- ============================================================
-- Phase 4 — Stock-take feature REMOVAL (destructive, upgrade-only)
-- ------------------------------------------------------------
-- Drops the two stock-take tables, the code sequence, and the six SPs
-- that made up the stock-take flow. If stock-take comes back later,
-- restore from git history (baseline files were fully removed too —
-- this doesn't recreate anything).
--
-- LEFT ALONE (deliberate):
--   • shop_inventory_movements rows with ref_type='StockTake' — those
--     Adjustment writes have already applied to on_hand and stay in
--     the ledger as audit history. The FE / BE no longer read them
--     specifically, but they still show up on the generic movement
--     lists as regular Adjustment lines.
--   • shop_inventory.on_hand — no unwind of past adjustments.
--
-- Idempotent: safe to re-run.
--
-- Author: Ramji J G   —   2026-08-03
-- ============================================================

BEGIN;

-- 1. SPs
DROP FUNCTION IF EXISTS fn_stock_take_start(uuid, uuid);
DROP FUNCTION IF EXISTS fn_stock_take_upsert_line(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS fn_stock_take_get(uuid);
DROP FUNCTION IF EXISTS fn_stock_take_list(uuid, varchar, date, date, int, int);
DROP FUNCTION IF EXISTS fn_stock_take_submit(uuid, uuid);
DROP FUNCTION IF EXISTS fn_stock_take_cancel(uuid, text, uuid);

-- 2. Tables (items first via FK, but CASCADE covers order either way).
DROP TABLE IF EXISTS shop_stock_take_items CASCADE;
DROP TABLE IF EXISTS shop_stock_takes      CASCADE;

-- 3. Sequence.
DROP SEQUENCE IF EXISTS stock_take_code_seq;

COMMIT;

-- ============================================================
-- VERIFY
-- ------------------------------------------------------------
-- No stock-take SPs:
--   SELECT proname FROM pg_proc WHERE proname LIKE 'fn_stock_take%';
--   (should return 0 rows)
--
-- No stock-take tables:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('shop_stock_takes', 'shop_stock_take_items');
--   (should return 0 rows)
--
-- No sequence:
--   SELECT sequence_name FROM information_schema.sequences
--   WHERE sequence_name = 'stock_take_code_seq';
--   (should return 0 rows)
--
-- Historical StockTake movements (kept, informational):
--   SELECT COUNT(*) FROM shop_inventory_movements WHERE ref_type = 'StockTake';
-- ============================================================
