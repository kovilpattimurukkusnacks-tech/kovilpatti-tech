import { useRef } from 'react'
import { TextField } from '@mui/material'

const fmt = new Intl.NumberFormat('en-IN')

// "150000" → "1,50,000" (and "1500.5" → "1,500.5" — only the integer part
// is ever comma-grouped, matches en-IN convention).
function formatDisplay(raw: string): string {
  if (!raw) return ''
  const dot = raw.indexOf('.')
  const intPart = dot === -1 ? raw : raw.slice(0, dot)
  const rest = dot === -1 ? '' : raw.slice(dot)
  const n = Number(intPart || '0')
  const formattedInt = Number.isNaN(n) ? intPart : fmt.format(n)
  return formattedInt + rest
}

// How many 0-9 digits appear in `s` before position `upTo`.
function digitsBefore(s: string, upTo: number): number {
  let count = 0
  for (let i = 0; i < upTo && i < s.length; i++) if (s[i] >= '0' && s[i] <= '9') count++
  return count
}

// Index right after the Nth digit in `s` — the inverse of digitsBefore,
// used to put the caret back where it was relative to the digits (not the
// raw character position, which shifts as commas are inserted/removed).
function indexAfterDigits(s: string, n: number): number {
  if (n <= 0) return 0
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] >= '0' && s[i] <= '9') {
      count++
      if (count === n) return i + 1
    }
  }
  return s.length
}

/** Comma-formatted amount input — formats live while typing (e.g.
 *  "15000" → "15,000" as you type the next digit), preserving caret
 *  position relative to the digits rather than the raw character index
 *  (which shifts every time a comma is inserted or removed). Also strips
 *  anything that isn't a digit or a single decimal point, which
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
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    const cursorPos = el.selectionStart ?? el.value.length
    const digitCount = digitsBefore(el.value, cursorPos)

    const raw = el.value.replace(/,/g, '').replace(/[^0-9.]/g, '')
    onChange(raw)

    // Restore the caret after the same digit once the reformatted value
    // has actually rendered — comma insertion/removal otherwise yanks the
    // caret to the end of the field on every keystroke.
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      const newPos = indexAfterDigits(formatDisplay(raw), digitCount)
      inputRef.current.setSelectionRange(newPos, newPos)
    })
  }

  return (
    <TextField
      label={label}
      value={formatDisplay(value)}
      onChange={handleChange}
      inputRef={inputRef}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      size="small"
      inputMode="decimal"
    />
  )
}
