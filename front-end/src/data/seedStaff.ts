import type { Staff } from '../types'

export const seedStaff: Staff[] = [
  { id: 'stf-1', username: 'inventory', fullName: 'Inventory Team', role: 'Inventory', inventoryId: 'inv-1', active: true },
  { id: 'stf-2', username: 'anna',      fullName: 'Anna Nagar',     role: 'ShopUser',  shopId: 'shp-1',     active: true },
  { id: 'stf-3', username: 'tnagar',    fullName: 'T. Nagar',       role: 'ShopUser',  shopId: 'shp-2',     active: true },
  { id: 'stf-4', username: 'velachery', fullName: 'Velachery',      role: 'ShopUser',  shopId: 'shp-3',     active: true },
  { id: 'stf-5', username: 'adyar',     fullName: 'Adyar',          role: 'ShopUser',  shopId: 'shp-4',     active: true },
  { id: 'stf-6', username: 'omr',       fullName: 'OMR',            role: 'ShopUser',  shopId: 'shp-5',     active: true },
]
