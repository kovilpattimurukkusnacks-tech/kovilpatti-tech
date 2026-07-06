import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Box } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import { useActiveSpecials } from '../hooks/useStockRequests'
import { useApp } from '../context/AppContext'

/**
 * Sticky banner listing every un-received Special Request in scope.
 * Client req (06-Jul-2026): the shop declares specialness on the review
 * step; from that moment until the shop confirms Received, the flag
 * needs to be persistently visible across shop / inv / admin so the
 * request can't get forgotten in the queue.
 *
 * Mount inside each role's layout, above <Outlet /> — it renders nothing
 * when the caller's scope has no active specials, so a normal working
 * day is uncluttered.
 *
 * Scope is server-side:
 *   • ShopUser  → own shop's specials
 *   • Inventory → own godown's specials
 *   • Admin     → tenant-wide
 *
 * Row click → jumps to the request detail page under the caller's role
 * prefix so the row opens the right detail (shop vs inventory vs admin
 * detail pages read the same DTO but live at different routes).
 */
export function ActiveSpecialsBanner() {
  const { data, isLoading } = useActiveSpecials()
  const { currentUser } = useApp()

  // Detail-page prefix per role. Kept in the component (not the hook)
  // because the same data set gets rendered under three different route
  // trees — banner needs to know where THIS user opens a request.
  const detailPrefix = useMemo(() => {
    switch (currentUser?.role) {
      case 'Admin':     return '/admin/requests'
      case 'Inventory': return '/inventory/requests'
      case 'ShopUser':  return '/shop/requests'
      default:          return '/shop/requests'
    }
  }, [currentUser?.role])

  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 8,
        bgcolor: '#FFE0B2',
        borderBottom: '2px solid #E8A758',
        px: { xs: 1.5, sm: 2 },
        py: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        flexWrap: 'wrap',
        // Soft shadow anchors the sticky strip visually when content
        // scrolls beneath it.
        boxShadow: '0 2px 4px rgba(124, 74, 0, 0.15)',
      }}
    >
      <StarIcon fontSize="small" sx={{ color: '#7C4A00' }} />
      <Box sx={{ fontWeight: 800, fontSize: 13, color: '#7C4A00', letterSpacing: 0.3 }}>
        {data.length} Special Request{data.length === 1 ? '' : 's'} open
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {data.map(s => (
          <Link
            key={s.id}
            to={`${detailPrefix}/${s.id}`}
            style={{ textDecoration: 'none' }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 1,
                // Warm cream (client pick 06-Jul-2026) — softer against the
                // amber strip than pure white. Hover deepens toward saffron.
                bgcolor: '#FFF8DC',
                border: '1px solid #E8A758',
                fontSize: 12,
                color: '#1F1F1F',
                cursor: 'pointer',
                '&:hover': { bgcolor: '#FFE9A6' },
              }}
            >
              <Box component="span" sx={{ fontWeight: 700, color: '#7C4A00' }}>
                {s.code}
              </Box>
              {/* Shop code identifies WHICH shop for inv+admin — for a
                  shop user this is always their own, but keeping it
                  keeps the component role-agnostic and the extra chars
                  don't clutter at this font size. */}
              <Box component="span" sx={{ color: '#1F1F1F99' }}>· {s.shopCode}</Box>
              {s.specialLabel && (
                <Box
                  component="span"
                  sx={{
                    fontStyle: 'italic',
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={s.specialLabel}
                >
                  · {s.specialLabel}
                </Box>
              )}
              <Box
                component="span"
                sx={{
                  fontWeight: 700,
                  fontSize: 10,
                  color: statusColor(s.status),
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                · {s.status}
              </Box>
            </Box>
          </Link>
        ))}
      </Box>
    </Box>
  )
}

// Amber-family tints per lifecycle stage. Match the STATUS_COLOR mapping
// used on the list pages so a Pending special reads the same on the
// banner as it does on its list row.
function statusColor(status: string): string {
  switch (status) {
    case 'Pending':    return '#E65100'
    case 'Approved':   return '#0277BD'
    case 'Dispatched': return '#2E7D32'
    default:           return '#7C4A00'
  }
}
