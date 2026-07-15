-- =====================================================================
-- phase1_gst_per_shop.sql
-- =====================================================================
-- Addendum: adds per-shop GST flag + global GST master switch.
-- Client #15 (19-Jun-2026):
--   • Settings page gets a "GST Tracking" master toggle (app_settings.gst_enabled)
--   • When master is ON, each shop has its own gst_enabled flag (per-shop list)
--   • Products Add/Edit dialog shows the GST input when master is ON
--
-- Idempotent — re-runnable safely:
--   • ALTER TABLE ... ADD COLUMN IF NOT EXISTS  → no-op if column exists
--   • INSERT INTO app_settings ... ON CONFLICT DO NOTHING
--   • DROP FUNCTION IF EXISTS + CREATE OR REPLACE  → swaps SP signatures cleanly
--
-- RUN ORDER: after phase1_init.sql + phase1_procedures.sql + phase2_init.sql.
-- =====================================================================

BEGIN;

-- 1. Per-shop flag. Default true so all existing shops opt-in (matches
--    the user's note that GST is already applied to all products at 5%).
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS gst_enabled boolean NOT NULL DEFAULT true;

-- 2. Master switch in app_settings.
INSERT INTO app_settings (key, value, description) VALUES
  ('gst_enabled', 'true',
   'Master switch for GST tracking. When false, the GST input on Products Add/Edit is hidden and per-shop GST flags are ignored downstream.')
ON CONFLICT (key) DO NOTHING;

-- 3. Update SPs to accept / return gst_enabled.
DROP FUNCTION IF EXISTS fn_shop_create(varchar, varchar, varchar, varchar, varchar, varchar, uuid, boolean, uuid);
DROP FUNCTION IF EXISTS fn_shop_update(uuid, varchar, varchar, varchar, varchar, varchar, uuid, boolean, uuid);
DROP FUNCTION IF EXISTS fn_shop_list();
DROP FUNCTION IF EXISTS fn_shop_get(uuid);

CREATE OR REPLACE FUNCTION fn_shop_create(
  p_code            varchar,
  p_name            varchar,
  p_address         varchar,
  p_contact_phone_1 varchar,
  p_contact_phone_2 varchar,
  p_gstin           varchar,
  p_inventory_id    uuid,
  p_active          boolean,
  p_gst_enabled     boolean,
  p_user_id         uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO shops (code, name, address, contact_phone_1, contact_phone_2,
                     gstin, inventory_id, active, gst_enabled, created_by, updated_by)
  VALUES (p_code, p_name, p_address, p_contact_phone_1, p_contact_phone_2,
          p_gstin, p_inventory_id, p_active, COALESCE(p_gst_enabled, true), p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_shop_update(
  p_id              uuid,
  p_name            varchar,
  p_address         varchar,
  p_contact_phone_1 varchar,
  p_contact_phone_2 varchar,
  p_gstin           varchar,
  p_inventory_id    uuid,
  p_active          boolean,
  p_gst_enabled     boolean,
  p_user_id         uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shops
  SET name            = p_name,
      address         = p_address,
      contact_phone_1 = p_contact_phone_1,
      contact_phone_2 = p_contact_phone_2,
      gstin           = p_gstin,
      inventory_id    = p_inventory_id,
      active          = p_active,
      gst_enabled     = COALESCE(p_gst_enabled, gst_enabled),
      updated_by      = p_user_id,
      updated_at      = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_shop_list()
RETURNS TABLE (
  id              uuid,
  code            varchar,
  name            varchar,
  address         varchar,
  contact_phone_1 varchar,
  contact_phone_2 varchar,
  gstin           varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean,
  gst_enabled     boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active, s.gst_enabled
  FROM shops s
  INNER JOIN inventories i ON i.id = s.inventory_id
  WHERE s.is_deleted = false
  ORDER BY s.code;
$$;

CREATE OR REPLACE FUNCTION fn_shop_get(p_id uuid)
RETURNS TABLE (
  id              uuid,
  code            varchar,
  name            varchar,
  address         varchar,
  contact_phone_1 varchar,
  contact_phone_2 varchar,
  gstin           varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean,
  gst_enabled     boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active, s.gst_enabled
  FROM shops s
  INNER JOIN inventories i ON i.id = s.inventory_id
  WHERE s.id = p_id AND s.is_deleted = false
  LIMIT 1;
$$;

-- 4. Paged list SP also returns gst_enabled (used by Shops admin list).
DROP FUNCTION IF EXISTS fn_shop_list_paged(int, int);

CREATE OR REPLACE FUNCTION fn_shop_list_paged(
  p_page      int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS TABLE (
  id              uuid,
  code            varchar,
  name            varchar,
  address         varchar,
  contact_phone_1 varchar,
  contact_phone_2 varchar,
  gstin           varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean,
  gst_enabled     boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active, s.gst_enabled
  FROM shops s
  INNER JOIN inventories i ON i.id = s.inventory_id
  WHERE s.is_deleted = false
  ORDER BY s.code
  LIMIT  GREATEST(p_page_size, 1)
  OFFSET GREATEST((p_page - 1) * p_page_size, 0);
$$;

-- 5. Fast-path SP for the AdminSettings per-shop toggle.
CREATE OR REPLACE FUNCTION fn_shop_set_gst_enabled(
  p_id          uuid,
  p_gst_enabled boolean,
  p_user_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shops
  SET gst_enabled = p_gst_enabled,
      updated_by  = p_user_id,
      updated_at  = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

COMMIT;
