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
-- 5. categories
-- ------------------------------------------------------------
CREATE TABLE categories (
  id         serial       PRIMARY KEY,
  name       varchar(50)  UNIQUE NOT NULL,
  active     boolean      NOT NULL DEFAULT true,
  is_deleted boolean      NOT NULL DEFAULT false,
  created_at timestamptz  NOT NULL DEFAULT now(),
  created_by uuid         REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  updated_by uuid         REFERENCES users(id) ON DELETE SET NULL
);

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
