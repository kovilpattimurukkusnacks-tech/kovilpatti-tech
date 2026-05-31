-- ============================================================
-- Kovilpatti Snacks — Shop-to-Godown Order Management
-- Phase 1 schema (DDL only — no seed data)
-- Target DB: PostgreSQL 13+ / Supabase
-- ============================================================
-- HOW TO RUN
--   Local PG (psql): psql -U postgres -f phase1_init.sql
--                    → CREATE DATABASE + \c run first, then schema.
--   Supabase: comment out STEP 1 below (you can't CREATE DATABASE
--             on Supabase — your project already has one called
--             "postgres"). Then paste the rest into SQL Editor and Run.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1 — Create the database and switch to it
--   Skip this block on Supabase.
--   `\c` is a psql meta-command; in GUI tools, run CREATE DATABASE
--   first, then switch your connection to sks_inventory before
--   running the rest of the file.
-- ------------------------------------------------------------
CREATE DATABASE sks_inventory;
\c sks_inventory

-- ------------------------------------------------------------
-- STEP 2 — Schema (single transaction)
-- ------------------------------------------------------------
BEGIN;

-- ------------------------------------------------------------
-- 0. Extension (gen_random_uuid lives in pgcrypto)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- 1. Enum types
-- ------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'shop_user', 'inventory');

-- ------------------------------------------------------------
-- 2. inventories  (godowns / warehouse locations)
--    created_by / updated_by FKs are added later, after users exists
-- ------------------------------------------------------------
CREATE TABLE inventories (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(20)   UNIQUE NOT NULL,
  name                varchar(120)  NOT NULL,
  address             varchar(250)  NOT NULL,
  contact_phone       varchar(20)   NOT NULL,
  contact_person_name varchar(120),
  active              boolean       NOT NULL DEFAULT true,
  is_deleted          boolean       NOT NULL DEFAULT false,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  updated_by          uuid
);

-- ------------------------------------------------------------
-- 3. shops  (each shop is mapped to one godown)
--    created_by / updated_by FKs are added later, after users exists
-- ------------------------------------------------------------
CREATE TABLE shops (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(20)   UNIQUE NOT NULL,
  name            varchar(120)  NOT NULL,
  address         varchar(250)  NOT NULL,
  contact_phone_1 varchar(20)   NOT NULL,
  contact_phone_2 varchar(20),
  gstin           varchar(15),
  inventory_id    uuid          NOT NULL REFERENCES inventories(id) ON DELETE RESTRICT,
  active          boolean       NOT NULL DEFAULT true,
  is_deleted      boolean       NOT NULL DEFAULT false,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT chk_shops_gstin_length CHECK (gstin IS NULL OR length(gstin) = 15)
);

CREATE INDEX idx_shops_inventory_id ON shops(inventory_id);

-- ------------------------------------------------------------
-- 4. users  (admin + shop_user + inventory; self-referencing FKs)
-- ------------------------------------------------------------
CREATE TABLE users (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  username      varchar(50)   UNIQUE NOT NULL,
  password_hash varchar(255)  NOT NULL,
  full_name     varchar(120)  NOT NULL,
  role          user_role     NOT NULL,
  shop_id       uuid          REFERENCES shops(id)       ON DELETE RESTRICT,
  inventory_id  uuid          REFERENCES inventories(id) ON DELETE RESTRICT,
  active        boolean       NOT NULL DEFAULT true,
  is_deleted    boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  updated_by    uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_user_role_binding CHECK (
    (role = 'shop_user' AND shop_id      IS NOT NULL AND inventory_id IS NULL) OR
    (role = 'inventory' AND inventory_id IS NOT NULL AND shop_id      IS NULL) OR
    (role = 'admin'     AND shop_id      IS NULL     AND inventory_id IS NULL)
  )
);

CREATE INDEX idx_users_shop_id      ON users(shop_id);
CREATE INDEX idx_users_inventory_id ON users(inventory_id);

-- Now wire the deferred audit FKs on inventories and shops
ALTER TABLE inventories
  ADD CONSTRAINT fk_inventories_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_inventories_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shops
  ADD CONSTRAINT fk_shops_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_shops_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 5. categories — nested (self-FK parent_id, NULL = root).
--    Unlimited depth; per client #1 (28-May-2026) the tree can nest
--    arbitrarily and products can sit on any node (root OR sub-category).
-- ------------------------------------------------------------
CREATE TABLE categories (
  id         serial       PRIMARY KEY,
  name       varchar(50)  NOT NULL,
  -- NULL = top-level category. ON DELETE RESTRICT so admin can't accidentally
  -- orphan the subtree by deleting a parent (a separate guard checks for
  -- products + child rows before allowing soft-delete).
  parent_id  int          REFERENCES categories(id) ON DELETE RESTRICT,
  active     boolean      NOT NULL DEFAULT true,
  is_deleted boolean      NOT NULL DEFAULT false,
  created_at timestamptz  NOT NULL DEFAULT now(),
  created_by uuid         REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  updated_by uuid         REFERENCES users(id) ON DELETE SET NULL,

  -- A category cannot be its own parent. The deeper cycle guard (parent of
  -- parent of … = self) lives in the trigger below; this CHECK catches the
  -- common single-step mistake without needing a function call.
  CONSTRAINT chk_categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Case-insensitive uniqueness, scoped per-parent. PostgreSQL UNIQUE treats
-- NULLs as distinct (pre-PG15), so we split into two partial indexes:
--   • Among the roots (parent_id IS NULL) — name is unique.
--   • Within a given parent — name is unique among that parent's children.
-- "Spicy" can exist under both "Snacks" and "Drinks" because their parent_id
-- differs. is_deleted=true rows are excluded so soft-deleted names free up.
CREATE UNIQUE INDEX idx_categories_unique_root_name
  ON categories(lower(name))
  WHERE parent_id IS NULL AND is_deleted = false;

CREATE UNIQUE INDEX idx_categories_unique_child_name
  ON categories(parent_id, lower(name))
  WHERE parent_id IS NOT NULL AND is_deleted = false;

-- Children lookup index — drives the tree-view recursive CTE.
CREATE INDEX idx_categories_parent ON categories(parent_id) WHERE is_deleted = false;

-- Cycle guard. Adjacency-list trees can be silently corrupted by a row whose
-- parent chain loops back to itself (e.g. A→B→C→A). The CHECK above blocks
-- the trivial case (parent_id = id); this trigger walks the ancestor chain
-- and raises when it sees p_id before reaching a NULL root.
CREATE OR REPLACE FUNCTION fn_categories_no_cycle()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_walker int := NEW.parent_id;
  v_steps  int := 0;
BEGIN
  WHILE v_walker IS NOT NULL LOOP
    -- Bail at any depth that's clearly bogus — protects against ALTER on a
    -- pathological dataset where the trigger isn't enough.
    v_steps := v_steps + 1;
    IF v_steps > 100 THEN
      RAISE EXCEPTION 'Category hierarchy is too deep (>100) or contains a cycle.';
    END IF;
    IF v_walker = NEW.id THEN
      RAISE EXCEPTION 'Cycle detected — category % cannot be a descendant of itself.', NEW.id;
    END IF;
    SELECT parent_id INTO v_walker FROM categories WHERE id = v_walker;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_no_cycle ON categories;
CREATE TRIGGER trg_categories_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION fn_categories_no_cycle();

-- ------------------------------------------------------------
-- 6. products
-- ------------------------------------------------------------
CREATE TABLE products (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20)   UNIQUE NOT NULL,
  name           varchar(120)  NOT NULL,
  category_id    int           NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  type           varchar(20)   NOT NULL,
  weight_value   numeric(10,3),
  weight_unit    varchar(5)    DEFAULT 'g',
  mrp            numeric(10,2) NOT NULL DEFAULT 0,
  purchase_price numeric(10,2) NOT NULL DEFAULT 0,
  -- GST rate as a percentage (e.g. 5, 12, 18, 28). Nullable + hidden in the UI
  -- for now; client will surface it in a later phase.
  gst            numeric(5,2),
  active         boolean       NOT NULL DEFAULT true,
  is_deleted     boolean       NOT NULL DEFAULT false,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_products_weight_unit   CHECK (weight_unit IN ('g','kg')),
  CONSTRAINT chk_products_prices_nonneg CHECK (mrp >= 0 AND purchase_price >= 0),
  CONSTRAINT chk_products_gst_range     CHECK (gst IS NULL OR (gst >= 0 AND gst <= 100))
);

CREATE INDEX idx_products_category ON products(category_id);

-- ------------------------------------------------------------
-- 7. updated_at trigger function + per-table triggers
--    (updated_by is set by the API on every UPDATE — the trigger
--     only refreshes updated_at)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventories_updated BEFORE UPDATE ON inventories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shops_updated       BEFORE UPDATE ON shops       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_categories_updated  BEFORE UPDATE ON categories  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated    BEFORE UPDATE ON products    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ============================================================
-- DONE. Verify with:
--   \dt              -- list tables (psql)
--   \dT              -- list user-defined types (psql)
-- On Supabase, the Table Editor will show all 5 tables.
-- ============================================================
