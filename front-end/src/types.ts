/**
 * App-wide shared types.
 *
 * Domain entities (Product, Shop, Inventory, User, StockRequest, …) live with
 * their API modules under `src/api/<resource>/types.ts` — those mirror the BE
 * DTOs. This file holds only cross-cutting types that aren't tied to one API.
 */

export type CurrentUser = {
  userId: string
  username: string
  fullName: string
  role: 'Admin' | 'ShopUser' | 'Inventory'
  shopId: string | null
  inventoryId: string | null
} | null
