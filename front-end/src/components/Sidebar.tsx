import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, LogOut, Users, Warehouse, Store, User, ChevronDown, ChevronRight, ClipboardList, Settings, Receipt, Truck, ListOrdered, IndianRupee, Boxes } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { featureFlags } from '../featureFlags'
import './Sidebar.css'

// 26-Sep-2026: the admin menu is grouped by job — Godown / Shops / Reports /
// Setup — instead of one flat list in build order. Routes are unchanged, so
// bookmarks keep working; only the grouping and two labels moved
// ("Create Account" → "Shops & Users", Settings stays on the gear below).

type NavItem = { to: string; label: string; icon: LucideIcon }
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[]; pathPrefixes: string[] }
type NavSection = { heading?: string; links?: NavItem[]; groups?: NavGroup[] }

// Phase 5a — vendor master + purchases. See DB/planned/phase5_vendor_purchases.md.
const purchasesGroup: NavGroup = {
  key: 'purchases',
  label: 'Purchases',
  icon: Truck,
  items: [
    { to: '/admin/vendors',   label: 'Vendors',   icon: Truck },
    { to: '/admin/purchases', label: 'Purchases', icon: ListOrdered },
  ],
  pathPrefixes: ['/admin/vendors', '/admin/purchases'],
}

// Formerly "Create Account" — one-time setup, so it sits at the bottom.
const shopsUsersGroup: NavGroup = {
  key: 'shops-users',
  label: 'Shops & Users',
  icon: Users,
  items: [
    { to: '/admin/create-account/inventory', label: 'Inventory', icon: Warehouse },
    { to: '/admin/create-account/shop',      label: 'Shop',      icon: Store },
    { to: '/admin/create-account/user',      label: 'User',      icon: User },
  ],
  pathPrefixes: ['/admin/create-account'],
}

const sections: NavSection[] = [
  // This-month movement chart (12-Jul-2026) — see AdminDashboard.tsx.
  { links: [{ to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    heading: 'Godown',
    links: [
      { to: '/admin/requests', label: 'Stock Requests', icon: ClipboardList },
      { to: '/admin/products', label: 'Products',       icon: Package },
    ],
    groups: [purchasesGroup],
  },
  // Phase 4d — POS billing admin views. Same flag as the shop-side Billing
  // menu, so the whole section appears together once billing goes live.
  ...(featureFlags.billing
    ? [{
        heading: 'Shops',
        links: [
          { to: '/admin/sales',      label: 'Sales',      icon: IndianRupee },
          { to: '/admin/shop-stock', label: 'Shop Stock', icon: Boxes },
        ],
      }]
    : []),
  // Accounts dashboard (Phase 3) — stock-movement value + expenses by date
  // range. Admin-only; only ever rendered inside the /admin route group.
  { heading: 'Reports', links: [{ to: '/admin/accounts', label: 'Accounts', icon: Receipt }] },
  { heading: 'Setup', groups: [shopsUsersGroup] },
  // Settings stays on the gear icon beside the Admin name at the bottom.
]

const allGroups = sections.flatMap(s => s.groups ?? [])

type Props = { onNavigate?: () => void }

export default function Sidebar({ onNavigate }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()

  const isGroupActive = (g: NavGroup) => g.pathPrefixes.some(p => location.pathname.startsWith(p))

  // Open/closed per collapsible group. A group starts open when the current
  // route is inside it.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(allGroups.map(g => [g.key, isGroupActive(g)])),
  )

  // Auto-expand whenever the user lands on a group's sub-route (back/forward
  // navigation, deep link).
  const activeGroupKey = allGroups.find(isGroupActive)?.key
  useEffect(() => {
    if (activeGroupKey) setOpenGroups(prev => (prev[activeGroupKey] ? prev : { ...prev, [activeGroupKey]: true }))
  }, [activeGroupKey])

  const handleLogout = () => {
    logout()
    navigate('/')
    onNavigate?.()
  }

  const renderLink = ({ to, label, icon: Icon }: NavItem) => (
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
  )

  const renderGroup = (g: NavGroup) => {
    const active = isGroupActive(g)
    const open = !!openGroups[g.key]
    const Icon = g.icon
    return (
      <div key={g.key}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpenGroups(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
            active
              ? 'gold-gradient shadow-lg shadow-black/30'
              : 'text-[#1F1F1F] hover:bg-[#1F1F1F]/10'
          }`}
        >
          <Icon className="w-4 h-4" />
          <span className="flex-1 text-left">{g.label}</span>
          {open
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />}
        </button>

        {open && (
          <div className="ml-3 mt-1 space-y-1 border-l-2 border-[#1F1F1F]/15 pl-3">
            {g.items.map(({ to, label, icon: ItemIcon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => onNavigate?.()}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'gold-gradient'
                      : 'text-[#1F1F1F]/85 hover:bg-[#1F1F1F]/10'
                  }`
                }
              >
                <ItemIcon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar-aside relative w-64 flex flex-col h-screen overflow-hidden text-[#1F1F1F]">
      <div className="relative z-10 px-4 py-5 border-b-2 border-[#1F1F1F]/15 flex flex-col items-center gap-2">
        <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="w-full max-w-[200px] h-auto" />
        <div className="text-xs text-[#1F1F1F]/75 font-bold uppercase tracking-widest">Admin Console</div>
      </div>

      <nav className="relative z-10 flex-1 px-3 py-4 overflow-y-auto">
        {sections.map((s, i) => (
          <div key={s.heading ?? `section-${i}`} className={i === 0 ? 'space-y-1.5' : 'mt-4 space-y-1.5'}>
            {s.heading && (
              <div className="px-3 pb-0.5 text-[11px] font-bold uppercase tracking-widest text-[#1F1F1F]/55">
                {s.heading}
              </div>
            )}
            {(s.links ?? []).map(renderLink)}
            {(s.groups ?? []).map(renderGroup)}
          </div>
        ))}
      </nav>

      <div className="relative z-10 px-4 py-4 border-t-2 border-[#1F1F1F]/15">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 gold-gradient rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-md shadow-black/30">
            {currentUser?.fullName.charAt(0).toUpperCase() ?? 'A'}
          </div>
          <div className="text-sm flex-1 min-w-0">
            <div className="font-bold truncate text-[#1F1F1F] uppercase tracking-wide">{currentUser?.fullName ?? 'Admin'}</div>
            <div className="text-xs text-[#1F1F1F]/65 font-medium">Admin</div>
          </div>
          {/* Settings — moved here from the nav list. Sits at the right corner
              of the Admin name row. Highlights when on the settings page. */}
          <NavLink
            to="/admin/settings"
            onClick={() => onNavigate?.()}
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) =>
              `flex-shrink-0 p-2 rounded-lg transition ${
                isActive
                  ? 'gold-gradient'
                  : 'text-[#1F1F1F] hover:bg-[#1F1F1F]/10'
              }`
            }
          >
            <Settings className="w-4 h-4" />
          </NavLink>
        </div>
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
