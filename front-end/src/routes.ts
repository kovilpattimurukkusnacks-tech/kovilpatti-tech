import type { CurrentUser } from './types'

type Role = NonNullable<CurrentUser>['role']

export const ROLE_HOME: Record<Role, string> = {
  Admin: '/admin/products',
  ShopUser: '/shop',
  Inventory: '/inventory',
}

export const roleHomePath = (role: Role): string => ROLE_HOME[role]
