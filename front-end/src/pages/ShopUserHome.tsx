import { useApp } from '../context/AppContext'
import './Landing.css'

export default function ShopUserHome() {
  const { currentUser, logout } = useApp()

  return (
    <div className="relative min-h-screen flex flex-col">
      <header className="relative z-10 px-6 sm:px-8 py-5 flex items-center justify-between gap-3">
        <img src="/logo.png" alt="Kovilpatti Murukku & Snacks" className="h-12 sm:h-14 w-auto" />
        <button
          onClick={logout}
          className="landing-login-submit bg-[#1F1F1F] hover:bg-[#0A0A0A] text-[#FCD835] px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition"
        >
          Logout
        </button>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          <div className="landing-welcome-card text-center px-6 py-8 rounded-2xl bg-white">
            <h1 className="text-2xl font-bold uppercase tracking-wide text-[#1F1F1F] mb-2">Shop Dashboard</h1>
            <p className="text-sm text-[#1F1F1F]/75 font-medium mb-4">
              Welcome, <span className="font-bold text-[#1F1F1F]">{currentUser?.fullName ?? currentUser?.username}</span>
            </p>
            <p className="text-xs text-[#1F1F1F]/60 font-medium uppercase tracking-widest">
              Shop User features coming soon
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
