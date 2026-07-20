import { useState } from 'react'
import { TextField } from '@mui/material'

const fmt = new Intl.NumberFormat('en-IN')

function formatDisplay(raw: string): string {
  if (!raw) return ''
  const n = Number(raw)
  return Number.isNaN(n) ? raw : fmt.format(n)
}

/** Plain-digit entry while focused (so typing isn't fighting comma
 *  insertion), comma-grouped display once blurred — e.g. "15,000". Also
 *  strips anything that isn't a digit or a single decimal point, which
 *  incidentally closes the classic <input type="number"> footgun (typing
 *  'e' / '+' / '-') without needing a separate keydown guard. */
export default function AmountField({
  label, value, onChange, required, disabled, autoFocus,
}: {
  label: string
  value: string
  onChange: (raw: string) => void
  required?: boolean
  disabled?: boolean
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)

  return (
    <TextField
      label={label}
      value={focused ? value : formatDisplay(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, ''))}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      size="small"
      inputMode="decimal"
    />
  )
}
