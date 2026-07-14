-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — Cumulative print: selective request IDs (one-shot)
-- 02-Jul-2026
--
-- Adds `p_request_ids uuid[]` as an optional second arg to
-- fn_request_pending_cumulative. When null / empty, behavior is unchanged
-- (aggregates every Approved request in the inventory scope). When
-- populated, aggregates only those IDs.
--
-- Signature change → DROP the pre-flag shape first (CREATE OR REPLACE
-- can't extend an argument list).
--
-- Backward compat: unchanged for callers that still pass one arg — Postgres
-- resolves them to the new function via the DEFAULT NULL on p_request_ids.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS fn_request_pending_cumulative(uuid);

CREATE OR REPLACE FUNCTION fn_request_pending_cumulative(
  p_inventory_id uuid   DEFAULT NULL,
  p_request_ids  uuid[] DEFAULT NULL
)
RETURNS TABLE (
  product_id      uuid,
  product_code    varchar,
  product_name    varchar,
  category_name   varchar,
  type            varchar,
  weight_value    numeric,
  weight_unit     varchar,
  total_qty       bigint,
  request_count   bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id                AS product_id,
    p.code              AS product_code,
    p.name              AS product_name,
    c.name              AS category_name,
    p.type              AS type,
    it.weight_value     AS weight_value,
    it.weight_unit      AS weight_unit,
    SUM(it.requested_qty)::bigint        AS total_qty,
    COUNT(DISTINCT r.id)::bigint         AS request_count
  FROM stock_requests r
  INNER JOIN stock_request_items it ON it.request_id = r.id
  INNER JOIN products            p  ON p.id  = it.product_id
  INNER JOIN categories          c  ON c.id  = p.category_id
  WHERE r.is_deleted = false
    AND r.status = 'Approved'
    AND (p_inventory_id IS NULL OR r.inventory_id = p_inventory_id)
    AND (p_request_ids  IS NULL OR cardinality(p_request_ids) = 0
         OR r.id = ANY(p_request_ids))
  GROUP BY p.id, p.code, p.name, c.name, p.type, it.weight_value, it.weight_unit
  ORDER BY p.code;
$$;
