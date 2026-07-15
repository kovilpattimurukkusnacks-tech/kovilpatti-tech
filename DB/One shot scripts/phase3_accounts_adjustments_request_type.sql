-- =====================================================================
-- phase3_accounts_adjustments_request_type.sql
-- =====================================================================
-- Addendum: adds request_type ('Order' | 'Return') to the by-adjustments
-- accounts SP. Client #13 (19-Jun-2026): FE Accounts view-mode lens needs
-- to filter the audit log by Order / Return slice so the Returns view
-- doesn't show Order-side adjustments (and vice versa).
--
-- Additive column — existing fields preserved.
--
-- Idempotent: drops the old signature first (return-type change),
-- then CREATE OR REPLACE the new one. Safe to re-run.
--
-- RUN ORDER: after phase3_init.sql + phase3_procedures.sql.
-- =====================================================================

DROP FUNCTION IF EXISTS fn_accounts_adjustments(date, date, uuid[], uuid[], int[]);

CREATE OR REPLACE FUNCTION fn_accounts_adjustments(
  p_from        date,
  p_to          date,
  p_shop_ids    uuid[]  DEFAULT NULL,
  p_inv_ids     uuid[]  DEFAULT NULL,
  p_cat_ids     int[]   DEFAULT NULL
)
RETURNS TABLE (
  audit_id        uuid,
  edited_at       timestamptz,
  request_id      uuid,
  request_code    varchar,
  request_type    varchar,
  shop_id         uuid,
  shop_name       varchar,
  product_id      uuid,
  product_name    varchar,
  weight_value    numeric,
  weight_unit     varchar,
  old_qty         int,
  new_qty         int,
  delta_qty       int,
  unit_price      numeric,
  delta_amount    numeric,
  reason          varchar,
  edited_by_id    uuid,
  edited_by_name  varchar
)
LANGUAGE sql STABLE AS $$
  WITH
  range AS (
    SELECT (p_from::timestamp     AT TIME ZONE 'Asia/Kolkata') AS lo,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS hi
  ),
  cat_closure AS (
    SELECT array_agg(id)::int[] AS ids
    FROM (
      WITH RECURSIVE walk AS (
        SELECT c.id FROM categories c
         WHERE c.is_deleted = false AND c.id = ANY(p_cat_ids)
        UNION
        SELECT c.id FROM categories c
        JOIN   walk w ON c.parent_id = w.id
         WHERE c.is_deleted = false
      )
      SELECT id FROM walk
    ) t
    WHERE p_cat_ids IS NOT NULL AND cardinality(p_cat_ids) > 0
    HAVING count(*) > 0
  )
  SELECT
    a.id                                                           AS audit_id,
    a.edited_at,
    a.request_id,
    r.code                                                         AS request_code,
    r.request_type                                                 AS request_type,
    r.shop_id,
    s.name                                                         AS shop_name,
    p.id                                                           AS product_id,
    p.name                                                         AS product_name,
    it.weight_value,
    it.weight_unit,
    a.old_qty,
    a.new_qty,
    (COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0))                AS delta_qty,
    it.unit_price,
    ((COALESCE(a.new_qty,0) - COALESCE(a.old_qty,0)) * it.unit_price)::numeric(14,2) AS delta_amount,
    a.reason,
    a.edited_by                                                    AS edited_by_id,
    u.full_name                                                    AS edited_by_name
  FROM stock_request_qty_audits a
  JOIN stock_request_items it ON it.id = a.request_item_id
  JOIN stock_requests       r  ON r.id  = a.request_id
  JOIN shops                s  ON s.id  = r.shop_id
  JOIN products             p  ON p.id  = it.product_id
  LEFT JOIN users           u  ON u.id  = a.edited_by
  , range g
  WHERE r.is_deleted = false
    AND a.edited_at >= g.lo AND a.edited_at < g.hi
    AND (p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 OR r.shop_id      = ANY(p_shop_ids))
    AND (p_inv_ids  IS NULL OR cardinality(p_inv_ids)  = 0 OR r.inventory_id = ANY(p_inv_ids))
    AND (
          NOT EXISTS (SELECT 1 FROM cat_closure)
          OR p.category_id = ANY((SELECT ids FROM cat_closure)::int[])
        )
  ORDER BY a.edited_at DESC;
$$;
