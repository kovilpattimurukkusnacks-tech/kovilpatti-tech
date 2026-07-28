import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, TextField } from '@mui/material'
import { UserPlus, UserCheck, X } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { useLookupCustomer, useCreateCustomer } from '../../hooks/useCustomers'
import type { CustomerDto } from '../../api/customers/types'

// ───────────────────────────────────────────────────────────────
// POS customer bar (features #6 + #4). Phone lookup; if not on file,
// a 30-second quick-add. Attaching a customer unlocks the Credit
// tender and shows their running credit balance.
// ───────────────────────────────────────────────────────────────

export default function CustomerBar({
  customer, onChange,
}: {
  customer: CustomerDto | null
  onChange: (c: CustomerDto | null) => void
}) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = useLookupCustomer()
  const create = useCreateCustomer()

  const handleFind = () => {
    const p = phone.trim()
    if (p.length !== 10) return
    setError(null); setShowAdd(false)
    lookup.mutate(p, {
      onSuccess: found => {
        if (found) { onChange(found); setPhone('') }
        else setShowAdd(true)   // not on file → reveal quick-add (name)
      },
      onError: err => setError(err instanceof Error ? err.message : 'Lookup failed.'),
    })
  }

  // Auto-look up the moment a full 10-digit number is entered — no need to
  // press Find (the button stays for a manual retry). Re-fires only when the
  // number changes, so editing then re-completing looks up again.
  useEffect(() => {
    if (phone.length === 10) handleFind()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  const handleAdd = () => {
    setError(null)
    create.mutate(
      { name: name.trim(), phone: phone.trim() },
      {
        onSuccess: c => { onChange(c); setPhone(''); setName(''); setShowAdd(false) },
        onError: err => setError(err instanceof Error ? err.message : 'Could not add customer.'),
      },
    )
  }

  if (customer) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, borderRadius: 2, bgcolor: '#FFFBE6', border: '1px solid rgba(31,31,31,0.15)' }}>
        <UserCheck className="w-4 h-4 text-[#2E7D32]" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ fontWeight: 700, fontSize: 13 }}>{customer.name}</Box>
          <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>{customer.phone}</Box>
        </Box>
        <Chip
          size="small"
          label={`Due ${formatINR(customer.creditBalance)}`}
          sx={{ fontWeight: 700, bgcolor: customer.creditBalance > 0 ? '#FFF4B8' : '#E8F5E9', color: customer.creditBalance > 0 ? '#8B6E00' : '#2E7D32' }}
        />
        <Button size="small" onClick={() => onChange(null)} sx={{ minWidth: 0, color: '#C62828' }} aria-label="Remove customer">
          <X className="w-4 h-4" />
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ mb: 2 }}>
      {error && <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert>}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={phone}
          // India mobile — digits only, exactly 10.
          onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setShowAdd(false) }}
          onKeyDown={e => { if (e.key === 'Enter') handleFind() }}
          placeholder="Customer mobile (10 digits)"
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 10 } }}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#FFFFFF' } }}
        />
        <Button
          variant="outlined"
          onClick={handleFind}
          disabled={phone.length !== 10 || lookup.isPending}
          sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap', color: '#1F1F1F', borderColor: 'rgba(31,31,31,0.35)' }}
        >
          {lookup.isPending ? '…' : 'Find'}
        </Button>
      </Box>

      {showAdd && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleAdd() }}
            placeholder="New customer name"
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#FFFFFF' } }}
          />
          <Button
            variant="contained"
            startIcon={<UserPlus className="w-4 h-4" />}
            onClick={handleAdd}
            disabled={!name.trim() || phone.length !== 10 || create.isPending}
            sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
