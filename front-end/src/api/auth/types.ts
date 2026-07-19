/** Mirrors the BE LoginRequest / LoginResponse DTOs. */

export type LoginRequest = {
  username: string
  password: string
}

export type LoginResponse = {
  token: string
  expiresAt: string  // ISO-8601 timestamp
  refreshToken: string  // opaque, rotated on every refresh
  userId: string     // UUID
  username: string
  fullName: string
  role: 'Admin' | 'ShopUser' | 'Inventory'
  shopId: string | null
  inventoryId: string | null
}

// /api/auth/refresh returns the same shape as login (new access + refresh token).
export type RefreshResponse = LoginResponse
