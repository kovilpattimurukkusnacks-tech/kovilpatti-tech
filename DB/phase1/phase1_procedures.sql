-- ============================================================
-- Kovilpatti Snacks — Phase 1 stored functions
-- Run AFTER phase1_init.sql
-- All write functions take p_user_id (or p_created_by) for audit columns.
-- ============================================================

BEGIN;

-- ============== Users ============================================

CREATE OR REPLACE FUNCTION fn_user_find_by_username(p_username varchar)
RETURNS TABLE (
  id            uuid,
  username      varchar,
  password_hash varchar,
  full_name     varchar,
  role          user_role,
  shop_id       uuid,
  inventory_id  uuid,
  active        boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role,
         u.shop_id, u.inventory_id, u.active
  FROM users u
  WHERE u.username = p_username
    AND u.active = true
    AND u.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_user_any_admin()
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin' AND is_deleted = false);
$$;

CREATE OR REPLACE FUNCTION fn_user_create(
  p_username      varchar,
  p_password_hash varchar,
  p_full_name     varchar,
  p_role          user_role,
  p_shop_id       uuid,
  p_inventory_id  uuid,
  p_created_by    uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO users (username, password_hash, full_name, role,
                     shop_id, inventory_id, created_by, updated_by)
  VALUES (p_username, p_password_hash, p_full_name, p_role,
          p_shop_id, p_inventory_id, p_created_by, p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============== Categories =======================================

CREATE OR REPLACE FUNCTION fn_category_exists(p_id int)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM categories WHERE id = p_id AND is_deleted = false);
$$;

CREATE OR REPLACE FUNCTION fn_category_list()
RETURNS TABLE (
  id     int,
  name   varchar,
  active boolean
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, c.active
  FROM categories c
  WHERE c.is_deleted = false
  ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION fn_category_get(p_id int)
RETURNS TABLE (
  id     int,
  name   varchar,
  active boolean
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, c.active
  FROM categories c
  WHERE c.id = p_id AND c.is_deleted = false
  LIMIT 1;
$$;

-- Case-insensitive name lookup, optionally excluding a specific id (used for
-- update-time uniqueness so a row doesn't conflict with itself).
CREATE OR REPLACE FUNCTION fn_category_exists_by_name(
  p_name       varchar,
  p_exclude_id int DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM categories
    WHERE lower(name) = lower(p_name)
      AND is_deleted = false
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  );
$$;

CREATE OR REPLACE FUNCTION fn_category_create(
  p_name    varchar,
  p_active  boolean,
  p_user_id uuid
)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_id int;
BEGIN
  INSERT INTO categories (name, active, created_by, updated_by)
  VALUES (p_name, p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_category_update(
  p_id      int,
  p_name    varchar,
  p_active  boolean,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE categories
  SET name       = p_name,
      active     = p_active,
      updated_by = p_user_id
  WHERE id = p_id AND is_deleted = false;
  RETURN FOUND;
END;
$$;

-- Soft delete. Blocks if ANY non-deleted product still references the category,
-- because hard-deleting would dangle category_id (FK has ON DELETE RESTRICT,
-- but products keep the row visible via the soft-delete flag).
-- Returns:
--   true   — soft-deleted
--   false  — not found (or already deleted)
-- Raises  — when in-use, with a clear message the BE surfaces to the user.
CREATE OR REPLACE FUNCTION fn_category_soft_delete(
  p_id      int,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_in_use_count int;
BEGIN
  SELECT count(*) INTO v_in_use_count
  FROM products
  WHERE category_id = p_id AND is_deleted = false;

  IF v_in_use_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete category — % product(s) still use it. Reassign or delete those products first.', v_in_use_count
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  UPDATE categories
  SET is_deleted = true,
      active     = false,
      updated_by = p_user_id
  WHERE id = p_id AND is_deleted = false;
  RETURN FOUND;
END;
$$;

-- ============== Products =========================================

CREATE OR REPLACE FUNCTION fn_product_list(
  p_search      varchar DEFAULT NULL,
  p_category_id int     DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  category_id    int,
  category_name  varchar,
  type           varchar,
  weight_value   numeric,
  weight_unit    varchar,
  mrp            numeric,
  purchase_price numeric,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.is_deleted = false
    AND (p_search IS NULL
         OR p.name ILIKE '%' || p_search || '%'
         OR p.code ILIKE '%' || p_search || '%')
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ORDER BY p.code;
$$;

CREATE OR REPLACE FUNCTION fn_product_get(p_id uuid)
RETURNS TABLE (
  id             uuid,
  code           varchar,
  name           varchar,
  category_id    int,
  category_name  varchar,
  type           varchar,
  weight_value   numeric,
  weight_unit    varchar,
  mrp            numeric,
  purchase_price numeric,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.active
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  WHERE p.id = p_id AND p.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_product_exists_by_code(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM products WHERE code = p_code);
$$;

CREATE OR REPLACE FUNCTION fn_product_next_code()
RETURNS varchar
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last varchar;
  v_n    int;
BEGIN
  SELECT code INTO v_last
  FROM products
  WHERE code LIKE 'P%'
  ORDER BY code DESC
  LIMIT 1;

  v_n := 1;
  IF v_last IS NOT NULL AND substring(v_last from 2) ~ '^[0-9]+$' THEN
    v_n := substring(v_last from 2)::int + 1;
  END IF;

  RETURN 'P' || lpad(v_n::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION fn_product_create(
  p_code           varchar,
  p_name           varchar,
  p_category_id    int,
  p_type           varchar,
  p_weight_value   numeric,
  p_weight_unit    varchar,
  p_mrp            numeric,
  p_purchase_price numeric,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO products (code, name, category_id, type,
                        weight_value, weight_unit, mrp, purchase_price,
                        active, created_by, updated_by)
  VALUES (p_code, p_name, p_category_id, p_type,
          p_weight_value, p_weight_unit, p_mrp, p_purchase_price,
          p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_product_update(
  p_id             uuid,
  p_name           varchar,
  p_category_id    int,
  p_type           varchar,
  p_weight_value   numeric,
  p_weight_unit    varchar,
  p_mrp            numeric,
  p_purchase_price numeric,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET name           = p_name,
      category_id    = p_category_id,
      type           = p_type,
      weight_value   = p_weight_value,
      weight_unit    = p_weight_unit,
      mrp            = p_mrp,
      purchase_price = p_purchase_price,
      active         = p_active,
      updated_by     = p_user_id,
      updated_at     = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_product_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

-- ============== Inventories ======================================

CREATE OR REPLACE FUNCTION fn_inventory_list()
RETURNS TABLE (
  id                  uuid,
  code                varchar,
  name                varchar,
  address             varchar,
  contact_phone       varchar,
  contact_person_name varchar,
  active              boolean
)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.name, i.address,
         i.contact_phone, i.contact_person_name, i.active
  FROM inventories i
  WHERE i.is_deleted = false
  ORDER BY i.code;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_get(p_id uuid)
RETURNS TABLE (
  id                  uuid,
  code                varchar,
  name                varchar,
  address             varchar,
  contact_phone       varchar,
  contact_person_name varchar,
  active              boolean
)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.name, i.address,
         i.contact_phone, i.contact_person_name, i.active
  FROM inventories i
  WHERE i.id = p_id AND i.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_exists(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM inventories WHERE id = p_id AND is_deleted = false);
$$;

CREATE OR REPLACE FUNCTION fn_inventory_exists_by_code(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM inventories WHERE code = p_code);
$$;

CREATE OR REPLACE FUNCTION fn_inventory_next_code()
RETURNS varchar
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last varchar;
  v_n    int;
BEGIN
  SELECT code INTO v_last
  FROM inventories
  WHERE code LIKE 'INV%'
  ORDER BY code DESC
  LIMIT 1;

  v_n := 1;
  IF v_last IS NOT NULL AND substring(v_last from 4) ~ '^[0-9]+$' THEN
    v_n := substring(v_last from 4)::int + 1;
  END IF;

  RETURN 'INV' || lpad(v_n::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_create(
  p_code                varchar,
  p_name                varchar,
  p_address             varchar,
  p_contact_phone       varchar,
  p_contact_person_name varchar,
  p_active              boolean,
  p_user_id             uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO inventories (code, name, address, contact_phone, contact_person_name,
                           active, created_by, updated_by)
  VALUES (p_code, p_name, p_address, p_contact_phone, p_contact_person_name,
          p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_inventory_update(
  p_id                  uuid,
  p_name                varchar,
  p_address             varchar,
  p_contact_phone       varchar,
  p_contact_person_name varchar,
  p_active              boolean,
  p_user_id             uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inventories
  SET name                = p_name,
      address             = p_address,
      contact_phone       = p_contact_phone,
      contact_person_name = p_contact_person_name,
      active              = p_active,
      updated_by          = p_user_id,
      updated_at          = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

-- ============== Shops ============================================

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
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active
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
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.code, s.name, s.address,
         s.contact_phone_1, s.contact_phone_2, s.gstin,
         s.inventory_id, i.name AS inventory_name, s.active
  FROM shops s
  INNER JOIN inventories i ON i.id = s.inventory_id
  WHERE s.id = p_id AND s.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_shop_exists_by_code(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM shops WHERE code = p_code);
$$;

CREATE OR REPLACE FUNCTION fn_shop_next_code()
RETURNS varchar
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_last varchar;
  v_n    int;
BEGIN
  SELECT code INTO v_last
  FROM shops
  WHERE code LIKE 'SHP%'
  ORDER BY code DESC
  LIMIT 1;

  v_n := 1;
  IF v_last IS NOT NULL AND substring(v_last from 4) ~ '^[0-9]+$' THEN
    v_n := substring(v_last from 4)::int + 1;
  END IF;

  RETURN 'SHP' || lpad(v_n::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION fn_shop_create(
  p_code            varchar,
  p_name            varchar,
  p_address         varchar,
  p_contact_phone_1 varchar,
  p_contact_phone_2 varchar,
  p_gstin           varchar,
  p_inventory_id    uuid,
  p_active          boolean,
  p_user_id         uuid
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO shops (code, name, address, contact_phone_1, contact_phone_2,
                     gstin, inventory_id, active, created_by, updated_by)
  VALUES (p_code, p_name, p_address, p_contact_phone_1, p_contact_phone_2,
          p_gstin, p_inventory_id, p_active, p_user_id, p_user_id)
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
      updated_by      = p_user_id,
      updated_at      = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_shop_exists(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM shops WHERE id = p_id AND is_deleted = false);
$$;

-- ============== Users (Staff CRUD) ===============================

CREATE OR REPLACE FUNCTION fn_user_username_exists(p_username varchar)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM users WHERE username = p_username);
$$;

CREATE OR REPLACE FUNCTION fn_user_list()
RETURNS TABLE (
  id              uuid,
  username        varchar,
  password_hash   varchar,
  full_name       varchar,
  role            user_role,
  shop_id         uuid,
  shop_name       varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role,
         u.shop_id, s.name AS shop_name,
         u.inventory_id, i.name AS inventory_name,
         u.active
  FROM users u
  LEFT JOIN shops s       ON s.id = u.shop_id
  LEFT JOIN inventories i ON i.id = u.inventory_id
  WHERE u.role <> 'admin' AND u.is_deleted = false
  ORDER BY u.username;
$$;

CREATE OR REPLACE FUNCTION fn_user_get(p_id uuid)
RETURNS TABLE (
  id              uuid,
  username        varchar,
  password_hash   varchar,
  full_name       varchar,
  role            user_role,
  shop_id         uuid,
  shop_name       varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, u.role,
         u.shop_id, s.name AS shop_name,
         u.inventory_id, i.name AS inventory_name,
         u.active
  FROM users u
  LEFT JOIN shops s       ON s.id = u.shop_id
  LEFT JOIN inventories i ON i.id = u.inventory_id
  WHERE u.id = p_id AND u.is_deleted = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_user_update(
  p_id           uuid,
  p_full_name    varchar,
  p_role         user_role,
  p_shop_id      uuid,
  p_inventory_id uuid,
  p_active       boolean,
  p_user_id      uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users
  SET full_name    = p_full_name,
      role         = p_role,
      shop_id      = p_shop_id,
      inventory_id = p_inventory_id,
      active       = p_active,
      updated_by   = p_user_id,
      updated_at   = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_user_password_update(
  p_id            uuid,
  p_password_hash varchar,
  p_user_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users
  SET password_hash = p_password_hash,
      updated_by    = p_user_id,
      updated_at    = now()
  WHERE id = p_id;

  RETURN FOUND;
END;
$$;

-- ============== Soft delete (sets is_deleted = true) =============
--   `active` is left alone — it remains a separate business flag.
--   Lists / get / FK-exists checks all filter is_deleted = false.

CREATE OR REPLACE FUNCTION fn_inventory_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE inventories
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_shop_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shops
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fn_user_soft_delete(p_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users
  SET is_deleted = true,
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_id AND is_deleted = false;

  RETURN FOUND;
END;
$$;

COMMIT;

-- ============================================================
-- DONE. Verify with:
--   \df fn_*       -- list all our functions (psql)
-- On Supabase, see the Database → Functions panel.
-- ============================================================
