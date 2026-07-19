-- ============================================================
-- phase1_refresh_tokens_migration.sql
--
-- Adds refresh-token support so an actively-used session is no longer
-- killed when the short-lived access token (JWT) expires. The client
-- silently exchanges a long-lived refresh token for a new access token.
--
-- Rotation: every refresh issues a NEW refresh token and revokes the old
-- one. Presenting an already-revoked token (theft / replay) revokes the
-- whole family for that user.
--
-- Raw tokens are never stored — only their SHA-256 hex hash. A DB leak
-- therefore does not expose usable refresh tokens.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 hex (64 chars) of the raw token the client holds.
  token_hash       varchar(64)  NOT NULL UNIQUE,
  expires_at       timestamptz  NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  -- Set when the token is rotated (superseded) or explicitly revoked (logout).
  revoked_at       timestamptz,
  -- Hash of the token that replaced this one on rotation (audit / family trace).
  replaced_by_hash varchar(64)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Issue a new refresh token (called at login and inside rotate).
CREATE OR REPLACE FUNCTION fn_refresh_token_issue(
  p_user_id    uuid,
  p_token_hash varchar,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, p_expires_at)
  RETURNING id;
$$;

-- Validate + rotate a refresh token. Returns the user fields needed to mint a
-- new access token when the old token is valid; returns NO ROWS on any failure
-- (unknown / expired / revoked-reuse / deactivated user) so the caller treats
-- it as "session over → re-login".
CREATE OR REPLACE FUNCTION fn_refresh_token_rotate(
  p_old_hash       varchar,
  p_new_hash       varchar,
  p_new_expires_at timestamptz
)
RETURNS TABLE (
  id           uuid,
  username     varchar,
  full_name    varchar,
  role         varchar,
  shop_id      uuid,
  inventory_id uuid,
  active       boolean
)
LANGUAGE plpgsql AS $$
DECLARE
  v_tok  refresh_tokens%ROWTYPE;
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_tok FROM refresh_tokens WHERE token_hash = p_old_hash;

  -- Unknown token → invalid.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Reuse of an already-revoked/rotated token → likely theft. Revoke the whole
  -- family for that user and refuse.
  IF v_tok.revoked_at IS NOT NULL THEN
    UPDATE refresh_tokens
      SET revoked_at = now()
      WHERE user_id = v_tok.user_id AND revoked_at IS NULL;
    RETURN;
  END IF;

  -- Expired → invalid.
  IF v_tok.expires_at <= now() THEN
    RETURN;
  END IF;

  -- User must still be active + not deleted. Qualify with the alias — the
  -- RETURNS TABLE out-columns (id, active) otherwise shadow users.id/active.
  SELECT * INTO v_user FROM users u
    WHERE u.id = v_tok.user_id AND u.active = true AND u.is_deleted = false;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Rotate: revoke the old, issue the new.
  UPDATE refresh_tokens
    SET revoked_at = now(), replaced_by_hash = p_new_hash
    WHERE token_hash = p_old_hash;

  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (v_tok.user_id, p_new_hash, p_new_expires_at);

  RETURN QUERY
    SELECT v_user.id, v_user.username, v_user.full_name,
           fn_user_role_label(v_user.role), v_user.shop_id, v_user.inventory_id,
           v_user.active;
END
$$;

-- Explicitly revoke a single refresh token (logout). Returns true if a live
-- token was revoked.
CREATE OR REPLACE FUNCTION fn_refresh_token_revoke(p_token_hash varchar)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE refresh_tokens
    SET revoked_at = now()
    WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  RETURN FOUND;
END
$$;

-- Revoke every live refresh token for a user (e.g. on password change / forced
-- logout everywhere). Returns the number revoked.
CREATE OR REPLACE FUNCTION fn_refresh_token_revoke_all_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE refresh_tokens
    SET revoked_at = now()
    WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
