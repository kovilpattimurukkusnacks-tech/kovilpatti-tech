import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Product, Inventory, Shop, Staff, CurrentUser } from '../types'
import { seedProducts } from '../data/seedProducts'
import { seedInventories } from '../data/seedInventories'
import { seedShops } from '../data/seedShops'
import { seedStaff } from '../data/seedStaff'
import { authApi } from '../api/auth/api'
import { tokenStore, UNAUTHORIZED_EVENT } from '../api/tokenStore'

const STORAGE_KEY = 'phase1.currentUser'

const categoryPrefix = (category: string) => {
  const c = (category || 'GEN').toUpperCase()
  return c.length >= 3 ? c.slice(0, 3) : c
}

const nextProductId = (products: Product[]) => {
  let max = 0
  for (const p of products) {
    const n = parseInt(p.id.replace(/^P/i, ''), 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `P${String(max + 1).padStart(3, '0')}`
}

const nextCode = (items: { code: string }[], prefix: string): string => {
  let max = 0
  for (const it of items) {
    const n = parseInt(it.code.replace(prefix, ''), 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

const nextSimpleId = (items: { id: string }[], prefix: string): string => {
  let max = 0
  for (const it of items) {
    const n = parseInt(it.id.replace(prefix, ''), 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

type InventoryInput = Omit<Inventory, 'id' | 'code'>
type ShopInput = Omit<Shop, 'id' | 'code'>
type StaffInput = Omit<Staff, 'id'>

type AppContextType = {
  currentUser: CurrentUser
  login: (username: string, password: string) => Promise<CurrentUser>
  logout: () => void

  products: Product[]
  addProduct: (input: Omit<Product, 'id' | 'sku'>) => Product
  updateProduct: (id: string, input: Omit<Product, 'id' | 'sku'>) => void
  deleteProduct: (id: string) => void

  inventories: Inventory[]
  addInventory: (input: InventoryInput) => Inventory
  updateInventory: (id: string, input: InventoryInput) => void
  deleteInventory: (id: string) => void

  shops: Shop[]
  addShop: (input: ShopInput) => Shop
  updateShop: (id: string, input: ShopInput) => void
  deleteShop: (id: string) => void

  staff: Staff[]
  addStaff: (input: StaffInput) => Staff
  updateStaff: (id: string, input: StaffInput) => void
  deleteStaff: (id: string) => void
  resetStaffPassword: (id: string, newPassword: string) => void
}

const AppContext = createContext<AppContextType | null>(null)

const loadStoredUser = (): CurrentUser => {
  // No JWT? Session is over — clears any stale state from the old mock login.
  if (!tokenStore.get()) {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    return null
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Shape check for the new CurrentUser fields. Old mock entries had
    // only { username, fullName } — drop them.
    if (typeof parsed.userId !== 'string' || typeof parsed.role !== 'string') {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      return null
    }
    return parsed as unknown as CurrentUser
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<CurrentUser>(loadStoredUser())
  const [products, setProducts] = useState<Product[]>(seedProducts)
  const [inventories, setInventories] = useState<Inventory[]>(seedInventories)
  const [shops, setShops] = useState<Shop[]>(seedShops)
  const [staff, setStaff] = useState<Staff[]>(seedStaff)

  const setCurrentUser = (u: CurrentUser) => {
    setCurrentUserState(u)
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    else localStorage.removeItem(STORAGE_KEY)
  }

  // Real auth — POST /api/auth/login. Stores JWT in tokenStore so the
  // API client attaches it to subsequent requests automatically. Returns
  // the new user on success, or null on failure (callers route by role).
  const login = async (username: string, password: string): Promise<CurrentUser> => {
    try {
      const res = await authApi.login({ username, password })
      tokenStore.set(res.token)
      const user = {
        userId: res.userId,
        username: res.username,
        fullName: res.fullName,
        role: res.role,
        shopId: res.shopId,
        inventoryId: res.inventoryId,
      }
      setCurrentUser(user)
      return user
    } catch {
      return null
    }
  }

  const logout = () => {
    tokenStore.clear()
    setCurrentUser(null)
  }

  // 401 handler — when any API call returns 401, the client clears the
  // token and dispatches this event. Drop currentUser so the auth guard
  // (Layout.tsx) bounces the user to /admin/login on next render.
  useEffect(() => {
    const handler = () => {
      setCurrentUserState(null)
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [])

  // Products ---------------------------------------------------------------

  const addProduct = (input: Omit<Product, 'id' | 'sku'>): Product => {
    const id = nextProductId(products)
    const sku = `${categoryPrefix(input.category)}-${id.replace(/^P/i, '')}`
    const product: Product = { id, sku, ...input }
    setProducts(prev => [...prev, product])
    return product
  }

  const updateProduct = (id: string, input: Omit<Product, 'id' | 'sku'>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...input } : p))
  }

  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  // Inventories ------------------------------------------------------------

  const addInventory = (input: InventoryInput): Inventory => {
    const id = nextSimpleId(inventories, 'inv-')
    const code = nextCode(inventories, 'INV')
    const inv: Inventory = { id, code, ...input }
    setInventories(prev => [...prev, inv])
    return inv
  }

  const updateInventory = (id: string, input: InventoryInput) => {
    setInventories(prev => prev.map(i => i.id === id ? { ...i, ...input } : i))
  }

  const deleteInventory = (id: string) => {
    setInventories(prev => prev.filter(i => i.id !== id))
  }

  // Shops ------------------------------------------------------------------

  const addShop = (input: ShopInput): Shop => {
    const id = nextSimpleId(shops, 'shp-')
    const code = nextCode(shops, 'SHP')
    const shop: Shop = { id, code, ...input }
    setShops(prev => [...prev, shop])
    return shop
  }

  const updateShop = (id: string, input: ShopInput) => {
    setShops(prev => prev.map(s => s.id === id ? { ...s, ...input } : s))
  }

  const deleteShop = (id: string) => {
    setShops(prev => prev.filter(s => s.id !== id))
  }

  // Staff ------------------------------------------------------------------

  const addStaff = (input: StaffInput): Staff => {
    const id = nextSimpleId(staff, 'stf-')
    const member: Staff = { id, ...input }
    setStaff(prev => [...prev, member])
    return member
  }

  const updateStaff = (id: string, input: StaffInput) => {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...input } : s))
  }

  const deleteStaff = (id: string) => {
    setStaff(prev => prev.filter(s => s.id !== id))
  }

  // Password reset is a no-op in the in-memory mock — we don't store
  // password hashes here. The signature exists so the UI flow can call it.
  const resetStaffPassword = (_id: string, _newPassword: string) => {
    /* no-op in mock */
  }

  return (
    <AppContext.Provider value={{
      currentUser, login, logout,
      products, addProduct, updateProduct, deleteProduct,
      inventories, addInventory, updateInventory, deleteInventory,
      shops, addShop, updateShop, deleteShop,
      staff, addStaff, updateStaff, deleteStaff, resetStaffPassword,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
