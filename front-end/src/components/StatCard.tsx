import type { LucideIcon } from 'lucide-react'
import './StatCard.css'

type Props = {
  label: string
  value: string | number
  icon: LucideIcon
  iconColor?: string
}

export default function StatCard({ label, value, icon: Icon, iconColor = 'bg-[#FCD835] text-[#1F1F1F]' }: Props) {
  return (
    <div className="stat-card rounded-xl p-5 bg-white">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#1F1F1F]/65">{label}</p>
          <p className="text-3xl font-bold text-[#1F1F1F] mt-1">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}
