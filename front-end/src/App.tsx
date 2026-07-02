import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'

import { AppProvider, useApp } from './context/AppContext'
import { roleHomePath, type Role } from './routes'
import { theme } from './theme'

import Layout from './components/Layout'
import ShopLayout from './components/ShopLayout'
import InventoryLayout from './components/InventoryLayout'
import Landing from './pages/Landing'
import Products from './pages/Products'
import Categories from './pages/Categories'
import Inventories from './pages/Inventories'
import Shops from './pages/Shops'
import Staff from './pages/Staff'
import InventoryRequests from './pages/inventory/InventoryRequests'
import InventoryRequestDetail from './pages/inventory/InventoryRequestDetail'
import ShopRequests from './pages/shop/ShopRequests'
import ShopRequestNew from './pages/shop/ShopRequestNew'
import ShopRequestDetail from './pages/shop/ShopRequestDetail'
import AdminRequests from './pages/admin/AdminRequests'
import AdminRequestDetail from './pages/admin/AdminRequestDetail'
import AdminSettings from './pages/admin/AdminSettings'
import AdminAccounts from './pages/admin/AdminAccounts'
import PrintRequestPicklist from './pages/print/PrintRequestPicklist'
import PrintRequestThermal from './pages/print/PrintRequestThermal'
import PrintCumulative from './pages/print/PrintCumulative'

// Role gate — bounces unauthenticated users to login, and any authenticated
// user whose role doesn't match this section to their own home page.
function RoleGate({ allow, children }: { allow: Role; children: React.ReactNode }) {
  const { currentUser } = useApp()
  if (!currentUser) return <Navigate to="/" replace />
  if (currentUser.role !== allow) return <Navigate to={roleHomePath(currentUser.role)} replace />
  return <>{children}</>
}

// Print gate — same auth check as RoleGate but allows any logged-in role.
// The /print/* routes intentionally bypass the role layouts so the page has
// no sidebar/header chrome, only the printable content.
function PrintGate({ children }: { children: React.ReactNode }) {
  const { currentUser } = useApp()
  if (!currentUser) return <Navigate to="/" replace />
  return <>{children}</>
}

// Data router — required for React Router hooks that intercept navigation
// (e.g. useBlocker, used by the unsaved-changes guard on the shop / inventory
// request pages). Defined at module scope so it isn't rebuilt on every render.
//
// The router lives inside the React tree via RouterProvider further down,
// so route components still see AppProvider's context (useApp, etc.).
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<Landing />} />
      <Route path="/admin/login" element={<Navigate to="/" replace />} />

      <Route path="/admin" element={<RoleGate allow="Admin"><Layout /></RoleGate>}>
        {/* Default landing inside /admin redirects to Products. */}
        <Route index element={<Navigate to="products" replace />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="create-account/inventory" element={<Inventories />} />
        <Route path="create-account/shop" element={<Shops />} />
        <Route path="create-account/user" element={<Staff />} />
        <Route path="requests" element={<AdminRequests />} />
        <Route path="requests/:id" element={<AdminRequestDetail />} />
        <Route path="requests/:id/edit" element={<ShopRequestNew />} />
        <Route path="accounts" element={<AdminAccounts />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>

      <Route path="/shop" element={<RoleGate allow="ShopUser"><ShopLayout /></RoleGate>}>
        <Route index element={<Navigate to="requests" replace />} />
        <Route path="requests" element={<ShopRequests />} />
        <Route path="requests/new" element={<ShopRequestNew />} />
        <Route path="requests/:id/edit" element={<ShopRequestNew />} />
        <Route path="requests/:id" element={<ShopRequestDetail />} />
      </Route>

      <Route path="/inventory" element={<RoleGate allow="Inventory"><InventoryLayout /></RoleGate>}>
        <Route index element={<Navigate to="requests" replace />} />
        <Route path="requests" element={<InventoryRequests />} />
        <Route path="requests/:id" element={<InventoryRequestDetail />} />
      </Route>

      {/* Print routes — standalone (no role layout) so they're paper-clean.
          Service still enforces role-scoped data access on the BE. */}
      <Route path="/print/request/:id"         element={<PrintGate><PrintRequestPicklist /></PrintGate>} />
      {/* Shop-user thermal (80mm) variant — same data, receipt layout. */}
      <Route path="/print/request/:id/thermal" element={<PrintGate><PrintRequestThermal  /></PrintGate>} />
      <Route path="/print/cumulative"  element={<PrintGate><PrintCumulative /></PrintGate>} />
    </>
  )
)

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ThemeProvider>
  )
}

export default App
