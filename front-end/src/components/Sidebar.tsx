import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
// LayoutDashboard kept for future Dashboard menu re-enable
// import { LayoutDashboard, Package, Warehouse, LogOut } from 'lucide-react'
import { Package, LogOut, UserPlus, Warehouse, Store, User, ChevronDown, ChevronRight } from 'lucide-react'
import { useApp } from '../context/AppContext'
import './Sidebar.css'

const navItems = [
  // Hidden for now — uncomment to re-enable Dashboard
  // { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/products', label: 'Products', icon: Package },
]

const createAccountItems = [
  { to: '/admin/create-account/inventory', label: 'Inventory', icon: Warehouse },
  { to: '/admin/create-account/shop',      label: 'Shop',      icon: Store },
  { to: '/admin/create-account/user',      label: 'User',      icon: User },
]

const CREATE_ACCOUNT_PATH_PREFIX = '/admin/create-account'

type Props = { onNavigate?: () => void }

export default function Sidebar({ onNavigate }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()

  const isCreateAccountActive = location.pathname.startsWith(CREATE_ACCOUNT_PATH_PREFIX)
  const [createAccountOpen, setCreateAccountOpen] = useState(isCreateAccountActive)

  // Auto-expand whenever the user lands on a Create Account sub-route
  // (e.g., back/forward navigation, deep link).
  useEffect(() => {
    if (isCreateAccountActive) setCreateAccountOpen(true)
  }, [isCreateAccountActive])

  const handleLogout = () => {
    logout()
    navigate('/')
    onNavigate?.()
  }

  return (
    <aside className="sidebar-aside relative w-64 flex flex-col h-screen overflow-hidden text-[#1F1F1F]">
      <div className="relative z-10 px-4 py-5 border-b-2 border-[#1F1F1F]/15 flex flex-col items-center gap-2">
        <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="w-full max-w-[200px] h-auto" />
        <div className="text-xs text-[#1F1F1F]/75 font-bold uppercase tracking-widest">Admin Console</div>
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
                  ? 'bg-[#1F1F1F] text-[#FCD835] shadow-lg shadow-black/30'
                  : 'text-[#1F1F1F] hover:bg-[#1F1F1F]/10'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          aria-expanded={createAccountOpen}
          onClick={() => setCreateAccountOpen(open => !open)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
            isCreateAccountActive
              ? 'bg-[#1F1F1F] text-[#FCD835] shadow-lg shadow-black/30'
              : 'text-[#1F1F1F] hover:bg-[#1F1F1F]/10'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span className="flex-1 text-left">Create Account</span>
          {createAccountOpen
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />}
        </button>

        {createAccountOpen && (
          <div className="ml-3 mt-1 space-y-1 border-l-2 border-[#1F1F1F]/15 pl-3">
            {createAccountItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => onNavigate?.()}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-[#1F1F1F] text-[#FCD835]'
                      : 'text-[#1F1F1F]/85 hover:bg-[#1F1F1F]/10'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="relative z-10 px-4 py-4 border-t-2 border-[#1F1F1F]/15">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-[#1F1F1F] text-[#FCD835] rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-md shadow-black/30">
            {currentUser?.fullName.charAt(0).toUpperCase() ?? 'A'}
          </div>
          <div className="text-sm flex-1 min-w-0">
            <div className="font-bold truncate text-[#1F1F1F] uppercase tracking-wide">{currentUser?.fullName ?? 'Admin'}</div>
            <div className="text-xs text-[#1F1F1F]/65 font-medium">Admin</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#1F1F1F] hover:bg-[#1F1F1F] hover:text-[#FCD835] font-bold transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          Logout
        </button>
      </div>
    </aside>
  )
}
