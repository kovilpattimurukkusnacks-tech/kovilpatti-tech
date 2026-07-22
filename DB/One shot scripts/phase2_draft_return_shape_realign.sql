-- 22-Jul-2026 — Realign fn_request_get_shop_draft's RETURNS TABLE with the
-- current shape of fn_request_get.
--
-- Bug: fn_request_get has picked up shop_contact_phone, accepted_by_name,
-- accepted_at, accepted_by, request_type, total_adjustment_qty,
-- source_request_id, source_request_code, is_special, special_label over
-- successive shop-side additions. fn_request_get_shop_draft was never
-- updated, so its `RETURN QUERY SELECT * FROM fn_request_get(v_id)` line
-- fails at runtime with:
--     structure of query does not match function result type
-- whenever a draft actually exists (empty-draft callers exited before
-- that SELECT, so it went unnoticed until Sentry caught the 500 on the
-- shop /shop/requests → GET /api/stock-requests/draft path).
--
-- Idempotent: DROPs both known prior signatures before the CREATE.

DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid);
DROP FUNCTION IF EXISTS fn_request_get_shop_draft(uuid, uuid);

CREATE OR REPLACE FUNCTION fn_request_get_shop_draft(p_shop_id uuid, p_user_id uuid)
RETURNS TABLE (
  id                      uuid,
  code                    varchar,
  shop_id                 uuid,
  shop_code               varchar,
  shop_name               varchar,
  shop_contact_phone      varchar,
  inventory_id            uuid,
  inventory_code          varchar,
  inventory_name          varchar,
  submitted_by_name       varchar,
  approved_by_name        varchar,
  dispatched_by_name      varchar,
  received_by_name        varchar,
  accepted_by_name        varchar,
  status                  varchar,
  request_type            varchar,
  total_items             int,
  total_qty               int,
  total_dispatched_qty    int,
  total_adjustment_qty    int,
  total_amount            numeric,
  total_dispatched_amount numeric,
  notes                   varchar,
  rejection_reason        varchar,
  editable_until          timestamptz,
  submitted_at            timestamptz,
  updated_at              timestamptz,
  approved_at             timestamptz,
  approved_by             uuid,
  dispatched_at           timestamptz,
  dispatched_by           uuid,
  received_at             timestamptz,
  accepted_at             timestamptz,
  accepted_by             uuid,
  cancelled_at            timestamptz,
  cancelled_by            uuid,
  source_request_id       uuid,
  source_request_code     varchar,
  is_special              boolean,
  special_label           varchar,
  items                   jsonb
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT r.id INTO v_id
  FROM stock_requests r
  WHERE r.shop_id = p_shop_id
    AND r.created_by = p_user_id
    AND r.status = 'Draft'
    AND r.is_deleted = false
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;   -- empty set
  END IF;

  RETURN QUERY SELECT * FROM fn_request_get(v_id);
END
$$;
