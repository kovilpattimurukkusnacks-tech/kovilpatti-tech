import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'

import { AppProvider, useApp } from './context/AppContext'
import { roleHomePath } from './routes'
import { theme } from './theme'

import Layout from './components/Layout'
import Landing from './pages/Landing'
// Dashboard hidden for now — uncomment to re-enable along with the index route below and the Sidebar entry.
// import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Categories from './pages/Categories'
import Inventories from './pages/Inventories'
import Shops from './pages/Shops'
import Staff from './pages/Staff'
import ShopUserHome from './pages/ShopUserHome'
import InventoryUserHome from './pages/InventoryUserHome'

// Role gate — bounces unauthenticated users to login, and any authenticated
// user whose role doesn't match this section to their own home page.
function RoleGate({ allow, children }: { allow: NonNullable<import('./types').CurrentUser>['role']; children: React.ReactNode }) {
  const { currentUser } = useApp()
  if (!currentUser) return <Navigate to="/" replace />
  if (currentUser.role !== allow) return <Navigate to={roleHomePath(currentUser.role)} replace />
  return <>{children}</>
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/admin/login" element={<Navigate to="/" replace />} />

            <Route path="/admin" element={<RoleGate allow="Admin"><Layout /></RoleGate>}>
              {/* Default landing inside /admin redirects to Products. Restore Dashboard by uncommenting. */}
              <Route index element={<Navigate to="products" replace />} />
              {/* <Route index element={<Dashboard />} /> */}
              <Route path="products" element={<Products />} />
              <Route path="categories" element={<Categories />} />
              <Route path="create-account/inventory" element={<Inventories />} />
              <Route path="create-account/shop" element={<Shops />} />
              <Route path="create-account/user" element={<Staff />} />
            </Route>

            <Route path="/shop" element={<RoleGate allow="ShopUser"><ShopUserHome /></RoleGate>} />
            <Route path="/inventory" element={<RoleGate allow="Inventory"><InventoryUserHome /></RoleGate>} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </ThemeProvider>
  )
}

export default App
