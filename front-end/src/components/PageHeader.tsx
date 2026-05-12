import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  action?: ReactNode
}

export default function PageHeader({ title, subtitle, action }: Props) {
  return (
    // sticky top-0 so the title row + action buttons stay visible when the
    // user scrolls long tables. Semi-transparent bg + backdrop-blur lets the
    // body's yellow gradient show through faintly for a clean overlay effect.
    <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 mb-4 bg-[#FFF8DC]/85 backdrop-blur-md border-b border-[#1F1F1F]/10 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-[#1F1F1F] truncate uppercase tracking-wide">{title}</h1>
        {subtitle && <p className="text-sm text-[#1F1F1F]/65 mt-1 font-medium">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
