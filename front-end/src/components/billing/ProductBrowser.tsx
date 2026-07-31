import { useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Paper,
} from '@mui/material'
import { X } from 'lucide-react'
import { formatINR } from '../../utils/format'
import { useBillingProducts } from '../../hooks/useBills'
import type { BillingProductDto } from '../../api/bills/types'

// ───────────────────────────────────────────────────────────────
// Product browse panel (client 25-Jul-2026). Shown BESIDE the bill as a
// split pane (not an overlay) — the bill stays visible while browsing.
// Category chips make the ~286-item catalogue navigable; tapping a tile
// adds to the bill.
// ───────────────────────────────────────────────────────────────

const UNCATEGORISED = 'Other'

export default function ProductBrowser({
  search, title, onClose, onAdd, qtyInCart,
}: {
  search: string            // driven by the POS top search box
  title: string
  onClose: () => void
  onAdd: (p: BillingProductDto) => void
  qtyInCart: (productId: string) => number
}) {
  const [category, setCategory] = useState<string | null>(null)   // null = All
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const productsQuery = useBillingProducts(search || undefined)
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) set.add(p.categoryName ?? UNCATEGORISED)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [products])

  const visible = useMemo(
    () => (category ? products.filter(p => (p.categoryName ?? UNCATEGORISED) === category) : products),
    [products, category],
  )

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden',
        position: { md: 'sticky' }, top: { md: 16 },
        display: 'flex', flexDirection: 'column', maxHeight: { md: 'calc(100vh - 32px)' },
      }}
    >
      <Box sx={{ bgcolor: '#FCD835', px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </Box>
        {productsQuery.isFetching && <CircularProgress size={14} sx={{ color: '#1F1F1F' }} />}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} startIcon={<X className="w-4 h-4" />}
          sx={{ textTransform: 'none', fontWeight: 700, color: '#1F1F1F' }}>
          Close
        </Button>
      </Box>

      <Box sx={{ p: 2, overflowY: 'auto' }}>
        {/* Category chips — collapsed to a single row by default (the cloud
            gets messy with 30+ categories); "+N more" expands. The selected
            category is always shown even when collapsed. */}
        {(() => {
          const COLLAPSED = 6
          const overflow = categories.length > COLLAPSED
          let shown = chipsExpanded ? categories : categories.slice(0, COLLAPSED)
          if (!chipsExpanded && category && !shown.includes(category)) {
            shown = [...shown.slice(0, COLLAPSED - 1), category]
          }
          return (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
              <Chip label="All" size="small" onClick={() => setCategory(null)}
                color={category === null ? 'primary' : 'default'} sx={{ fontWeight: 700 }} />
              {shown.map(c => (
                <Chip key={c} label={c} size="small" onClick={() => setCategory(c)}
                  color={category === c ? 'primary' : 'default'} sx={{ fontWeight: 700 }} />
              ))}
              {overflow && (
                <Chip
                  label={chipsExpanded ? 'Show less' : `+${categories.length - shown.length} more`}
                  size="small"
                  variant="outlined"
                  onClick={() => setChipsExpanded(e => !e)}
                  sx={{ fontWeight: 700, borderColor: 'rgba(31,31,31,0.35)' }}
                />
              )}
            </Box>
          )
        })()}

        {productsQuery.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {productsQuery.error instanceof Error ? productsQuery.error.message : 'Failed to load products.'}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
            gap: 1.5,
          }}
        >
          {visible.map(p => {
            const out = p.onHand <= 0
            const inCart = qtyInCart(p.id)
            return (
              <Paper
                key={p.id}
                elevation={0}
                onClick={() => { if (!out) onAdd(p) }}
                sx={{
                  p: 1.5, borderRadius: 2, border: '2px solid rgba(31,31,31,0.2)',
                  bgcolor: out ? '#F5F5F5' : inCart > 0 ? '#FFF4B8' : '#FFFBE6',
                  cursor: out ? 'not-allowed' : 'pointer', opacity: out ? 0.6 : 1,
                  transition: 'all 0.15s', position: 'relative',
                  ...(!out && { '&:hover': { borderColor: '#1F1F1F' } }),
                }}
              >
                {inCart > 0 && (
                  <Chip label={`×${inCart}`} size="small"
                    sx={{ position: 'absolute', top: 6, right: 6, height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#1F1F1F', color: '#FFD700' }} />
                )}
                <Box sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, mb: 0.5, pr: 3 }}>{p.name}</Box>
                <Box sx={{ fontSize: 11, color: '#1F1F1F99', mb: 1 }}>
                  {p.weightValue != null ? `${p.weightValue} ${p.weightUnit ?? ''} · ` : ''}{p.code}
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ fontWeight: 700, fontSize: 14 }}>{formatINR(p.mrp)}</Box>
                  <Chip
                    label={out ? 'Out' : `${p.onHand} left`}
                    size="small"
                    sx={{
                      height: 20, fontSize: 10, fontWeight: 700,
                      bgcolor: out ? '#C62828' : p.onHand < 5 ? '#FFF4B8' : '#E8F5E9',
                      color: out ? '#FFFFFF' : p.onHand < 5 ? '#8B6E00' : '#2E7D32',
                    }}
                  />
                </Box>
              </Paper>
            )
          })}
          {visible.length === 0 && !productsQuery.isLoading && (
            <Box sx={{ gridColumn: '1 / -1', textAlign: 'center', color: '#1F1F1F99', py: 4 }}>
              No products found.
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  )
}
