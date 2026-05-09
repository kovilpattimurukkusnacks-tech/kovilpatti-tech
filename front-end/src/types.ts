export type Product = {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  unitPrice: number
  weightValue: number
  weightUnit: 'g' | 'kg'
}

export type Inventory = {
  id: string
  code: string
  name: string
  address: string
  contactPhone: string
  contactPersonName?: string
  active: boolean
}

export type Shop = {
  id: string
  code: string
  name: string
  address: string
  contactPhone1: string
  contactPhone2?: string
  gstin?: string
  inventoryId: string
  active: boolean
}

export type StaffRole = 'ShopUser' | 'Inventory'

export type Staff = {
  id: string
  username: string
  fullName: string
  role: StaffRole
  shopId?: string
  inventoryId?: string
  active: boolean
}

export type CurrentUser = {
  userId: string
  username: string
  fullName: string
  role: 'Admin' | 'ShopUser' | 'Inventory'
  shopId: string | null
  inventoryId: string | null
} | null
