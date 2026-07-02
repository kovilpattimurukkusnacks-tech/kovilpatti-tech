/** Mirrors the BE UserDto / CreateStaffRequest / UpdateStaffRequest / ResetPasswordRequest. */

export type UserRole = 'Admin' | 'ShopUser' | 'Inventory'

export type UserDto = {
  id: string                          // UUID
  username: string
  fullName: string
  role: UserRole
  shopId: string | null
  shopName: string | null
  inventoryId: string | null
  inventoryName: string | null
  active: boolean
}

/** Staff role on the create/edit form — Admin is not selectable. */
export type StaffRole = Exclude<UserRole, 'Admin'>

export type CreateStaffRequest = {
  username: string
  password: string
  fullName: string
  role: StaffRole
  shopId?: string                    // required when role === 'ShopUser'
  inventoryId?: string               // required when role === 'Inventory'
  active?: boolean
}

export type UpdateStaffRequest = {
  fullName: string
  role: StaffRole
  shopId?: string
  inventoryId?: string
  active: boolean
}

export type ResetPasswordRequest = {
  newPassword: string
}
