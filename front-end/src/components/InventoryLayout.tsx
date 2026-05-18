import { useState } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Drawer, IconButton } from '@mui/material'
import InventorySidebar from './InventorySidebar'
import { useApp } from '../context/AppContext'
import './Layout.css'

export default function InventoryLayout() {
  const { currentUser } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!currentUser) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block sticky top-0 h-screen">
        <InventorySidebar />
      </div>

      <Drawer
        className="layout-drawer"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', lg: 'none' } }}
      >
        <InventorySidebar onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <div className="flex-1 flex flex-col min-w-0">
        <IconButton
          onClick={() => setMobileOpen(true)}
          className="layout-mobile-menu"
          sx={{ display: { lg: 'none' } }}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </IconButton>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
