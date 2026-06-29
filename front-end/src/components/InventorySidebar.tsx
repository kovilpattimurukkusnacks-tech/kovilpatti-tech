import { NavLink, useNavigate } from 'react-router-dom'
import { ClipboardList, LogOut, Warehouse } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useInventory } from '../hooks/useInventories'
import './Sidebar.css'

const navItems = [
  { to: '/inventory/requests', label: 'Incoming Requests', icon: ClipboardList },
]

type Props = { onNavigate?: () => void }

export default function InventorySidebar({ onNavigate }: Props) {
  const navigate = useNavigate()
  const { currentUser, logout } = useApp()
  // 29-Jun-2026: surface the inventory (godown) name + code below the user
  // line so dispatchers always see which godown they're acting on. Shared
  // cache with useInventories() — no extra network call on most pages.
  const inventoryQuery = useInventory(currentUser?.inventoryId ?? undefined)

  const handleLogout = () => {
    logout()
    navigate('/')
    onNavigate?.()
  }

  return (
    <aside className="sidebar-aside relative w-64 flex flex-col h-screen overflow-hidden text-[#1F1F1F]">
      <div className="relative z-10 px-4 py-5 border-b-2 border-[#1F1F1F]/15 flex flex-col items-center gap-2">
        <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="w-full max-w-[200px] h-auto" />
        <div className="text-xs text-[#1F1F1F]/75 font-bold uppercase tracking-widest">Inventory Console</div>
      </div>

      <nav className="relative z-10 flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => onNavigate?.()}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                isActive
                  ? 'gold-gradient shadow-lg shadow-black/30'
                  : 'text-[#1F1F1F] hover:bg-[#1F1F1F]/10'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="relative z-10 px-4 py-4 border-t-2 border-[#1F1F1F]/15">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 gold-gradient rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-md shadow-black/30">
            {currentUser?.fullName.charAt(0).toUpperCase() ?? 'I'}
          </div>
          <div className="text-sm flex-1 min-w-0">
            <div className="font-bold truncate text-[#1F1F1F] uppercase tracking-wide">{currentUser?.fullName ?? 'Inventory User'}</div>
            <div className="text-xs text-[#1F1F1F]/65 font-medium">Inventory</div>
          </div>
        </div>
        {/* Godown badge — mirrors the shop badge on ShopSidebar. */}
        {inventoryQuery.data && (
          <div className="flex items-center gap-2 mb-3 px-2.5 py-2 rounded-lg bg-[#1F1F1F]/8 border border-[#1F1F1F]/15">
            <Warehouse className="w-4 h-4 flex-shrink-0 text-[#1F1F1F]/70" />
            <div className="text-sm font-bold truncate text-[#1F1F1F]">{inventoryQuery.data.name}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#1F1F1F] hover:gold-gradient font-bold transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          Logout
        </button>
      </div>
    </aside>
  )
}
