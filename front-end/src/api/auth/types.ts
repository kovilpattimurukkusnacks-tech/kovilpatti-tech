/** Mirrors the BE LoginRequest / LoginResponse DTOs. */

export type LoginRequest = {
  username: string
  password: string
}

export type LoginResponse = {
  token: string
  expiresAt: string  // ISO-8601 timestamp
  userId: string     // UUID
  username: string
  fullName: string
  role: 'Admin' | 'ShopUser' | 'Inventory'
  shopId: string | null
  inventoryId: string | null
}
