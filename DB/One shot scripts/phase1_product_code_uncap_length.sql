-- =====================================================================
-- phase1_product_code_uncap_length.sql
-- =====================================================================
-- Addendum: drop the 20-character cap on products.code.
-- Client #10 (07-Jun-2026): admin needs to use longer descriptive codes
-- (e.g. "MURUKKU-PLAIN-100G-PACK") that the original varchar(20) cap
-- rejected. UNIQUE + NOT NULL constraints preserved.
--
-- Idempotent: ALTER TYPE TEXT is a no-op when the column is already text.
-- Safe even on fresh phase1_init.sql installs (which already use text).
--
-- RUN ORDER: after phase1_init.sql; runs independently of procedures
-- because the SP signatures use just `varchar` without a length cap.
-- =====================================================================

ALTER TABLE products
  ALTER COLUMN code TYPE text;
