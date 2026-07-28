-- ============================================================
-- Kovilpatti Snacks — Phase 4c · fn_billing_products + category_name
--
-- Adds the product's (leaf) category name to the POS product source so
-- the billing "Browse products" overlay can group tiles by category.
-- Return type changes, so DROP first (CREATE OR REPLACE can't do it).
--
-- Idempotent. Baked into DB/phase4/phase4_billing_procedures.sql too.
-- ============================================================

DROP FUNCTION IF EXISTS fn_billing_products(uuid, varchar, int);

CREATE OR REPLACE FUNCTION fn_billing_products(
  p_shop_id  uuid,
  p_search   varchar DEFAULT NULL,
  p_limit    int     DEFAULT 500
)
RETURNS TABLE (
  id            uuid,
  code          text,
  barcode       varchar,
  name          varchar,
  category_name varchar,
  weight_value  numeric,
  weight_unit   varchar,
  mrp           numeric,
  on_hand       numeric
)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
         p.code,
         p.barcode,
         p.name,
         c.name AS category_name,
         p.weight_value,
         p.weight_unit,
         p.mrp,
         COALESCE(si.on_hand, 0) AS on_hand
  FROM   products p
  LEFT   JOIN categories c ON c.id = p.category_id
  LEFT   JOIN shop_inventory si
         ON si.product_id = p.id AND si.shop_id = p_shop_id
  WHERE  p.is_deleted = false
    AND  p.active = true
    AND  (p_search IS NULL OR p_search = ''
          OR p.name    ILIKE '%' || p_search || '%'
          OR p.code    ILIKE '%' || p_search || '%'
          OR p.barcode ILIKE '%' || p_search || '%')
  ORDER  BY (COALESCE(si.on_hand, 0) > 0) DESC, p.name
  LIMIT  p_limit;
$$;
