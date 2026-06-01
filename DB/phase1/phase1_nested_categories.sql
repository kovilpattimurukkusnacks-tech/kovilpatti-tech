-- ============================================================
-- Migration 01 — Nested categories (client #1, 28-May-2026)
--
-- Adds parent_id self-FK + partial unique indexes + cycle-prevention
-- trigger to the categories table on an existing Phase 1 deploy.
--
-- Run BEFORE re-running phase1_procedures.sql (which now expects
-- parent_id to exist on categories).
--
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- 1. parent_id column -------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id int REFERENCES categories(id) ON DELETE RESTRICT;

-- 2. Drop the original UNIQUE(name) so siblings under different parents
--    can share a name ("Spicy" under both "Snacks" and "Drinks").
ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_name_key;

-- 3. Self-not-self CHECK ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_categories_not_self_parent'
      AND conrelid = 'categories'::regclass
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT chk_categories_not_self_parent
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- 4. Partial unique indexes for case-insensitive name-within-parent --------
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_root_name
  ON categories(lower(name))
  WHERE parent_id IS NULL AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_child_name
  ON categories(parent_id, lower(name))
  WHERE parent_id IS NOT NULL AND is_deleted = false;

-- 5. Children lookup index — drives the tree-view recursive CTE.
CREATE INDEX IF NOT EXISTS idx_categories_parent
  ON categories(parent_id) WHERE is_deleted = false;

-- 6. Cycle-prevention trigger ----------------------------------------------
CREATE OR REPLACE FUNCTION fn_categories_no_cycle()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_walker int := NEW.parent_id;
  v_steps  int := 0;
BEGIN
  WHILE v_walker IS NOT NULL LOOP
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

COMMIT;

-- VERIFY -------------------------------------------------------------------
-- \d categories                        -- parent_id column present
-- SELECT id, name, parent_id FROM categories;
-- ============================================================
