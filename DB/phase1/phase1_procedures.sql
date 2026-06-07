-- ============================================================
-- Kovilpatti Snacks — Phase 1 stored functions
-- Run AFTER phase1_init.sql
-- All write functions take p_user_id (or p_created_by) for audit columns.
-- ============================================================

BEGIN;

-- ============== Users ============================================

-- Map the PG enum (snake_case: 'admin' / 'shop_user' / 'inventory') to the
-- PascalCase labels the C# UserRole enum uses (Admin / ShopUser / Inventory).
-- Without this, Dapper can't reconcile 'shop_user' ↔ ShopUser via its
-- default case-insensitive string→enum match (the underscore breaks it),
-- and shop user login fails with a 500 even though admin/inventory work.
CREATE OR REPLACE FUNCTION fn_user_role_label(r user_role)
RETURNS varchar
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'admin'     THEN 'Admin'
    WHEN 'shop_user' THEN 'ShopUser'
    WHEN 'inventory' THEN 'Inventory'
  END::varchar;
$$;

-- All four user-listing SPs return `role` as varchar (via the helper above)
-- because Npgsql 8+ rejects unmapped custom enum types on the read path.
-- DROP needed where the RETURNS TABLE shape changed from user_role → varchar.
DROP FUNCTION IF EXISTS fn_user_find_by_username(varchar);

CREATE OR REPLACE FUNCTION fn_user_find_by_username(p_username varchar)
RETURNS TABLE (
  id            uuid,
  username      varchar,
  password_hash varchar,
  full_name     varchar,
  role          varchar,
  shop_id       uuid,
  inventory_id  uuid,
  active        boolean
)
LANGUAGE sql STABLE AS $$
  -- fn_user_role_label(u.role) — Npgsql 8+ rejects unmapped custom enum types on the
  -- read path. Casting to varchar here lets the BE stay agnostic of enum
  -- registration at the data source level.
  SELECT u.id, u.username, u.password_hash, u.full_name, fn_user_role_label(u.role),
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

-- ---- fn_category_list ------------------------------------------------
-- Flat list. Now also surfaces parent_id + breadcrumb path so callers that
-- can't recurse (legacy code, simple pickers) still get the hierarchy info
-- in one shot. Path is " > "-joined names from root to this node.
DROP FUNCTION IF EXISTS fn_category_list();
CREATE OR REPLACE FUNCTION fn_category_list()
RETURNS TABLE (
  id        int,
  name      varchar,
  parent_id int,
  path      varchar,
  depth     int,
  active    boolean
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE tree AS (
    SELECT c.id, c.name, c.parent_id, c.name::varchar AS path, 0 AS depth, c.active, c.is_deleted
    FROM categories c
    WHERE c.parent_id IS NULL AND c.is_deleted = false
    UNION ALL
    SELECT c.id, c.name, c.parent_id,
           (t.path || ' > ' || c.name)::varchar AS path,
           t.depth + 1, c.active, c.is_deleted
    FROM categories c
    JOIN tree t ON c.parent_id = t.id
    WHERE c.is_deleted = false
  )
  SELECT id, name, parent_id, path, depth, active
  FROM tree
  ORDER BY path;
$$;

-- ---- fn_category_get -------------------------------------------------
DROP FUNCTION IF EXISTS fn_category_get(int);
CREATE OR REPLACE FUNCTION fn_category_get(p_id int)
RETURNS TABLE (
  id        int,
  name      varchar,
  parent_id int,
  path      varchar,
  depth     int,
  active    boolean
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    -- Walk from this node back to root, collecting names along the way.
    SELECT c.id, c.name, c.parent_id, c.active, c.is_deleted, 0 AS depth,
           ARRAY[c.name::text] AS names
    FROM categories c
    WHERE c.id = p_id AND c.is_deleted = false
    UNION ALL
    SELECT p.id, p.name, p.parent_id, p.active, p.is_deleted, u.depth + 1,
           p.name::text || u.names
    FROM categories p
    JOIN up u ON p.id = u.parent_id
    WHERE p.is_deleted = false
  )
  SELECT u.id, u.name, u.parent_id,
         array_to_string(top.names, ' > ')::varchar AS path,
         top.depth AS depth, u.active
  FROM up u
  JOIN (
    SELECT names, depth FROM up ORDER BY depth DESC LIMIT 1
  ) top ON true
  WHERE u.id = p_id
  LIMIT 1;
$$;

-- ---- fn_category_tree ------------------------------------------------
-- Same shape as fn_category_list (root-first, depth-ordered) but exposed
-- under a name that signals the recursive tree intent. Used by the admin
-- tree UI + the cascading category picker (#6) on the product form.
CREATE OR REPLACE FUNCTION fn_category_tree()
RETURNS TABLE (
  id        int,
  name      varchar,
  parent_id int,
  path      varchar,
  depth     int,
  active    boolean
)
LANGUAGE sql STABLE AS $$
  SELECT * FROM fn_category_list();
$$;

-- Case-insensitive name lookup, scoped to siblings under the same parent.
-- p_parent_id IS NULL means "check among root categories". p_exclude_id is
-- used during update so a row doesn't conflict with itself.
DROP FUNCTION IF EXISTS fn_category_exists_by_name(varchar, int);
CREATE OR REPLACE FUNCTION fn_category_exists_by_name(
  p_name       varchar,
  p_parent_id  int DEFAULT NULL,
  p_exclude_id int DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM categories
    WHERE lower(name) = lower(p_name)
      AND is_deleted = false
      AND parent_id IS NOT DISTINCT FROM p_parent_id
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  );
$$;

DROP FUNCTION IF EXISTS fn_category_create(varchar, boolean, uuid);
CREATE OR REPLACE FUNCTION fn_category_create(
  p_name      varchar,
  p_parent_id int,
  p_active    boolean,
  p_user_id   uuid
)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_id int;
BEGIN
  -- Parent must exist + be non-deleted when provided. Cycle prevention is
  -- delegated to the trigger on the table.
  IF p_parent_id IS NOT NULL AND NOT fn_category_exists(p_parent_id) THEN
    RAISE EXCEPTION 'Parent category % not found (or deleted).', p_parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO categories (name, parent_id, active, created_by, updated_by)
  VALUES (p_name, p_parent_id, p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS fn_category_update(int, varchar, boolean, uuid);
CREATE OR REPLACE FUNCTION fn_category_update(
  p_id        int,
  p_name      varchar,
  p_parent_id int,
  p_active    boolean,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  -- Same parent-exists guard as create. The cycle-prevention trigger picks
  -- up the BEFORE UPDATE and rejects self-descendant assignments.
  IF p_parent_id IS NOT NULL AND p_parent_id <> p_id AND NOT fn_category_exists(p_parent_id) THEN
    RAISE EXCEPTION 'Parent category % not found (or deleted).', p_parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  UPDATE categories
  SET name       = p_name,
      parent_id  = p_parent_id,
      active     = p_active,
      updated_by = p_user_id
  WHERE id = p_id AND is_deleted = false;
  RETURN FOUND;
END;
$$;

-- Soft delete. Blocks if ANY non-deleted product still references the category,
-- OR if the category has non-deleted children — admin must clear those first
-- (otherwise the subtree would orphan).
-- Returns:
--   true   — soft-deleted
--   false  — not found (or already deleted)
-- Raises  — when in-use OR has children, with a clear message the BE surfaces.
CREATE OR REPLACE FUNCTION fn_category_soft_delete(
  p_id      int,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_in_use_count   int;
  v_child_count    int;
BEGIN
  SELECT count(*) INTO v_in_use_count
  FROM products
  WHERE category_id = p_id AND is_deleted = false;

  IF v_in_use_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete category — % product(s) still use it. Reassign or delete those products first.', v_in_use_count
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT count(*) INTO v_child_count
  FROM categories
  WHERE parent_id = p_id AND is_deleted = false;

  IF v_child_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete category — % sub-categor(y/ies) still reference it. Delete or move them first.', v_child_count
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

-- The product SPs gained a `gst` column. CREATE OR REPLACE cannot change a
-- function's return type or argument list, so drop the old signatures first.
-- IF EXISTS makes this safe on a fresh DB.
DROP FUNCTION IF EXISTS fn_product_list(varchar, int);
DROP FUNCTION IF EXISTS fn_product_get(uuid);
DROP FUNCTION IF EXISTS fn_product_create(varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, boolean, uuid);
-- fn_product_update signature changed twice — first gained `gst`, then
-- `code` (07-Jun-2026, client #10). CREATE OR REPLACE can't change arg
-- lists so we drop every prior shape. IF EXISTS keeps each safe.
DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, int, varchar, numeric, varchar, numeric, numeric, boolean, uuid);
DROP FUNCTION IF EXISTS fn_product_update(uuid, varchar, varchar, int, varchar, numeric, varchar, numeric, numeric, boolean, uuid);

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
  gst            numeric,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
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
  gst            numeric,
  active         boolean
)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.code, p.name, p.category_id, c.name AS category_name,
         p.type, p.weight_value, p.weight_unit,
         p.mrp, p.purchase_price, p.gst, p.active
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
  p_gst            numeric,
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
                        gst, active, created_by, updated_by)
  VALUES (p_code, p_name, p_category_id, p_type,
          p_weight_value, p_weight_unit, p_mrp, p_purchase_price,
          p_gst, p_active, p_user_id, p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_product_update(
  p_id             uuid,
  p_code           varchar,
  p_name           varchar,
  p_category_id    int,
  p_type           varchar,
  p_weight_value   numeric,
  p_weight_unit    varchar,
  p_mrp            numeric,
  p_purchase_price numeric,
  p_gst            numeric,
  p_active         boolean,
  p_user_id        uuid
)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  -- Code is editable as of 07-Jun-2026 (client #10). Uniqueness is guarded
  -- by the UNIQUE constraint on products.code — service does a pre-check
  -- against OTHER rows for a clean error; this insert/update still trips
  -- the constraint if a concurrent writer collides.
  UPDATE products
  SET code           = p_code,
      name           = p_name,
      category_id    = p_category_id,
      type           = p_type,
      weight_value   = p_weight_value,
      weight_unit    = p_weight_unit,
      mrp            = p_mrp,
      purchase_price = p_purchase_price,
      gst            = p_gst,
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

-- TODO(multi-inventory): when PROD onboards a 2nd inventory/godown, this SP
-- must also cascade the shop's new inventory_id onto in-flight stock requests.
-- Today PROD has one inventory so reassignment never happens and this is safe.
-- The day a 2nd inventory is added, also do the following inside this tx:
--   UPDATE stock_requests
--   SET    inventory_id = p_inventory_id,
--          updated_at   = now()
--   WHERE  shop_id  = p_id
--     AND  status   IN ('Pending', 'Approved')
--     AND  inventory_id IS DISTINCT FROM p_inventory_id;
-- Dispatched/Received/Rejected/Cancelled stay frozen to the original godown
-- because those rows represent goods that physically left that godown — the
-- audit trail must remain consistent. Pre-dispatch rows follow the shop.
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

-- `role` column cast user_role → varchar; signature stays but RETURNS TABLE
-- shape changed. DROP needed.
DROP FUNCTION IF EXISTS fn_user_list();

CREATE OR REPLACE FUNCTION fn_user_list()
RETURNS TABLE (
  id              uuid,
  username        varchar,
  password_hash   varchar,
  full_name       varchar,
  role            varchar,
  shop_id         uuid,
  shop_name       varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, fn_user_role_label(u.role),
         u.shop_id, s.name AS shop_name,
         u.inventory_id, i.name AS inventory_name,
         u.active
  FROM users u
  LEFT JOIN shops s       ON s.id = u.shop_id
  LEFT JOIN inventories i ON i.id = u.inventory_id
  WHERE u.role <> 'admin' AND u.is_deleted = false
  ORDER BY u.username;
$$;

DROP FUNCTION IF EXISTS fn_user_get(uuid);

CREATE OR REPLACE FUNCTION fn_user_get(p_id uuid)
RETURNS TABLE (
  id              uuid,
  username        varchar,
  password_hash   varchar,
  full_name       varchar,
  role            varchar,
  shop_id         uuid,
  shop_name       varchar,
  inventory_id    uuid,
  inventory_name  varchar,
  active          boolean
)
LANGUAGE sql STABLE AS $$
  SELECT u.id, u.username, u.password_hash, u.full_name, fn_user_role_label(u.role),
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
