import type { CurrentUser } from './types'

type Role = NonNullable<CurrentUser>['role']

export const ROLE_HOME: Record<Role, string> = {
  // 12-Jul-2026 — was /admin/products. Client req: admin lands on the
  // dashboard first, same pattern as ShopUser (/shop → /shop/dashboard).
  Admin: '/admin/dashboard',
  ShopUser: '/shop',
  Inventory: '/inventory',
}

export const roleHomePath = (role: Role): string => ROLE_HOME[role]
