import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, ClipboardList,
  ClipboardCheck, Package, Sparkles, TrendingUp, Wallet,
} from 'lucide-react'
import { Alert, Box, Button, Chip, Paper, Skeleton } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useShopDashboard } from '../../hooks/useShopInventory'
import type {
  MovementType, ShopInventoryMovementDto,
} from '../../api/shop-inventory/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'

/**
 * Shop user's post-login landing page (see project_kovilpatti_shop_landing
 * memory). Pulls one aggregated payload from GET /api/shop-dashboard.
 * Widgets are gated by data — empty states render inline where the shop
 * hasn't built up any activity yet.
 */
export default function ShopDashboard() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useShopDashboard()

  if (isError) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {(error as Error)?.message ?? 'Failed to load dashboard.'}
      </Alert>
    )
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          isLoading
            ? 'Loading…'
            : data
              ? `${data.shopName} · ${data.shopCode}`
              : undefined
        }
        action={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<ClipboardList className="w-4 h-4" />}
              onClick={() => navigate('/shop/requests/new')}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              New Request
            </Button>
          </Box>
        }
      />

      {/* ─── Top strip: 3 KPI tiles ─── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        <KpiTile
          icon={<Wallet className="w-5 h-5" />}
          label="Stock Value"
          value={isLoading ? undefined : formatINR(data?.inventoryValue ?? 0)}
          sublabel={
            isLoading
              ? undefined
              : `${data?.skuCount ?? 0} ${data?.skuCount === 1 ? 'product' : 'products'} on hand`
          }
          tone="primary"
        />
        <KpiTile
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Low Stock"
          value={isLoading ? undefined : String(data?.lowStockCount ?? 0)}
          sublabel={
            (data?.lowStockCount ?? 0) > 0
              ? 'below reorder threshold'
              : 'nothing urgent'
          }
          tone={(data?.lowStockCount ?? 0) > 0 ? 'warning' : 'muted'}
        />
        <KpiTile
          icon={<ClipboardList className="w-5 h-5" />}
          label="Pending Requests"
          value={isLoading ? undefined : String(data?.pendingRequestsCount ?? 0)}
          sublabel={
            (data?.pendingRequestsCount ?? 0) > 0
              ? 'awaiting godown approval'
              : 'all caught up'
          }
          tone="muted"
        />
      </Box>

      {/* ─── Today's activity strip ─── */}
      <Paper elevation={0} sx={panelSx}>
        <SectionHeader
          icon={<TrendingUp className="w-4 h-4" />}
          title="Today's activity"
        />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 1.5,
            mt: 1.5,
          }}
        >
          <ActivityRow
            icon={<ArrowUpRight className="w-4 h-4" />}
            label="Received"
            primary={
              isLoading
                ? undefined
                : `${data?.todayReceipts ?? 0} ${data?.todayReceipts === 1 ? 'delivery' : 'deliveries'}`
            }
            secondary={
              (data?.todayReceipts ?? 0) > 0
                ? `${data?.todayReceiptsQty ?? 0} units in`
                : 'none yet today'
            }
            tone="positive"
          />
          <ActivityRow
            icon={<Sparkles className="w-4 h-4" />}
            label="Adjustments"
            primary={
              isLoading
                ? undefined
                : `${data?.todayAdjustments ?? 0} ${data?.todayAdjustments === 1 ? 'record' : 'records'}`
            }
            secondary={
              (data?.todayAdjustments ?? 0) > 0
                ? 'stock-take / manual corrections'
                : 'no corrections today'
            }
            tone="muted"
          />
        </Box>
      </Paper>

      {/* ─── Low stock alerts + Last stock-take (two-column on desktop) ─── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
          gap: 2,
          mb: 3,
        }}
      >
        <Paper elevation={0} sx={panelSx}>
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-[#C62828]" />}
            title="Low stock"
            trailing={
              (data?.lowStockCount ?? 0) > 0 ? (
                <Chip
                  size="small"
                  label={`${data?.lowStockCount ?? 0} items`}
                  sx={{
                    borderRadius: 999, fontWeight: 700, fontSize: 11,
                    bgcolor: '#FFEBEE', color: '#B71C1C',
                    border: '1px solid rgba(198,40,40,0.35)',
                  }}
                />
              ) : undefined
            }
          />
          {isLoading ? (
            <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
            </Box>
          ) : (data?.lowStock.length ?? 0) === 0 ? (
            <EmptyState
              message="No items are below the reorder threshold. 🎉"
            />
          ) : (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {data!.lowStock.map(item => {
                const isOut = item.onHand <= 0
                return (
                  <Box
                    key={item.productId}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      px: 1.5, py: 1,
                      borderRadius: 1,
                      bgcolor: isOut ? '#FFEBEE' : '#FFF8E1',
                      border: `1px solid ${isOut ? 'rgba(198,40,40,0.35)' : 'rgba(194,138,0,0.35)'}`,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ fontWeight: 700, fontSize: 13.5, color: '#1F1F1F' }}>
                        {item.productName}
                      </Box>
                      <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
                        {item.productCode} · MRP {formatINR(item.mrp)}
                      </Box>
                    </Box>
                    <Chip
                      size="small"
                      label={isOut ? 'OUT' : `${item.onHand} left`}
                      sx={{
                        borderRadius: 999, fontWeight: 800, fontSize: 11,
                        bgcolor: isOut ? '#C62828' : '#FFF3E0',
                        color: isOut ? '#FFFFFF' : '#7C4A00',
                        border: isOut ? 'none' : '1px solid rgba(194,138,0,0.45)',
                      }}
                    />
                  </Box>
                )
              })}
              {(data?.lowStockCount ?? 0) > data!.lowStock.length && (
                <Box sx={{ fontSize: 12, color: '#1F1F1F99', textAlign: 'center', pt: 0.5 }}>
                  + {data!.lowStockCount - data!.lowStock.length} more —
                  view the full inventory to see all.
                </Box>
              )}
            </Box>
          )}
        </Paper>

        <Paper elevation={0} sx={panelSx}>
          <SectionHeader
            icon={<ClipboardCheck className="w-4 h-4" />}
            title="Last stock-take"
          />
          {isLoading ? (
            <Skeleton variant="rectangular" height={80} sx={{ mt: 1.5, borderRadius: 1 }} />
          ) : !data?.lastStockTake ? (
            <EmptyState
              message="No stock-takes recorded yet."
              hint="Run a physical count to reconcile shelf stock with the system."
            />
          ) : (
            <Box
              sx={{
                mt: 1, px: 1.5, py: 1.25,
                borderRadius: 1,
                bgcolor: '#FFFBE6',
                border: '1px solid rgba(31,31,31,0.15)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box sx={{ fontWeight: 700, fontSize: 14 }}>{data.lastStockTake.code}</Box>
                <Chip
                  size="small"
                  label={data.lastStockTake.status}
                  sx={{
                    borderRadius: 999, fontWeight: 700, fontSize: 10,
                    ...(data.lastStockTake.status === 'Submitted'
                      ? { bgcolor: '#E8F5E9', color: '#1B5E20', border: '1px solid rgba(46,125,50,0.4)' }
                      : data.lastStockTake.status === 'Draft'
                      ? { bgcolor: '#FFF8E1', color: '#7C4A00', border: '1px solid rgba(194,138,0,0.45)' }
                      : { bgcolor: '#F5F5F5', color: '#616161', border: '1px solid rgba(0,0,0,0.15)' }),
                  }}
                />
              </Box>
              <Box sx={{ fontSize: 11.5, color: '#1F1F1F99' }}>
                Started {formatIstDateTime(data.lastStockTake.startedAt)}
              </Box>
              <Box sx={{ mt: 0.75, display: 'flex', gap: 2, fontSize: 12 }}>
                <span>
                  <strong>{data.lastStockTake.itemCount}</strong> lines
                </span>
                <span>
                  <strong>{data.lastStockTake.diffCount}</strong> diffs
                </span>
                <span
                  style={{
                    color: data.lastStockTake.netDiffQty !== 0 ? '#C62828' : '#1F1F1F99',
                  }}
                >
                  Net <strong>{data.lastStockTake.netDiffQty > 0 ? '+' : ''}{data.lastStockTake.netDiffQty}</strong>
                </span>
              </Box>
            </Box>
          )}
        </Paper>
      </Box>

      {/* ─── Recent activity feed ─── */}
      <Paper elevation={0} sx={panelSx}>
        <SectionHeader
          icon={<Package className="w-4 h-4" />}
          title="Recent activity"
        />
        {isLoading ? (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} variant="rectangular" height={44} sx={{ borderRadius: 1 }} />
            ))}
          </Box>
        ) : (data?.recentMovements.length ?? 0) === 0 ? (
          <EmptyState
            message="No inventory movements yet."
            hint="Once the godown dispatches a request and you confirm receipt, movements will land here."
          />
        ) : (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {data!.recentMovements.map(m => (
              <MovementRow key={m.id} m={m} />
            ))}
          </Box>
        )}
      </Paper>
    </div>
  )
}

// ═══════════════ Sub-components ═══════════════

const panelSx = {
  borderRadius: 2.5,
  bgcolor: '#FFFBE6',
  border: '1px solid rgba(31,31,31,0.12)',
  p: 2,
  mb: 2,
} as const

function KpiTile({
  icon, label, value, sublabel, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string | undefined
  sublabel?: string
  tone: 'primary' | 'warning' | 'muted'
}) {
  // "primary" = gold gradient (matches active-preset buttons + New Request);
  // "warning" = amber-tinted card with warm accent; "muted" = quiet cream.
  const isPrimary = tone === 'primary'
  const isWarning = tone === 'warning'
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2, borderRadius: 2.5,
        border: '1px solid rgba(31,31,31,0.12)',
        ...(isPrimary
          ? {
              background: 'linear-gradient(135deg, #FFF1A6 0%, #FFD700 65%, #E6B800 100%)',
              borderColor: '#C28A00',
              boxShadow: '0 4px 12px rgba(194,138,0,0.25)',
            }
          : isWarning
          ? { bgcolor: '#FFF3E0', borderColor: 'rgba(194,138,0,0.45)' }
          : { bgcolor: '#FFF8E1' }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, color: '#1F1F1F' }}>
        {icon}
        <Box sx={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </Box>
      </Box>
      {value === undefined ? (
        <Skeleton variant="text" width="60%" height={36} />
      ) : (
        <Box sx={{ fontSize: 28, fontWeight: 800, color: '#1F1F1F', lineHeight: 1.1 }}>
          {value}
        </Box>
      )}
      {sublabel && (
        <Box sx={{ mt: 0.5, fontSize: 12, color: '#1F1F1F99' }}>{sublabel}</Box>
      )}
    </Paper>
  )
}

function SectionHeader({
  icon, title, trailing,
}: {
  icon: React.ReactNode
  title: string
  trailing?: React.ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {icon}
      <Box sx={{ fontWeight: 800, fontSize: 15, flex: 1 }}>{title}</Box>
      {trailing}
    </Box>
  )
}

function ActivityRow({
  icon, label, primary, secondary, tone,
}: {
  icon: React.ReactNode
  label: string
  primary: string | undefined
  secondary: string
  tone: 'positive' | 'muted'
}) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: 1.25,
        borderRadius: 1.5,
        bgcolor: tone === 'positive' ? '#F1F8E9' : '#FFF8E1',
        border: `1px solid ${tone === 'positive' ? 'rgba(46,125,50,0.25)' : 'rgba(194,138,0,0.3)'}`,
      }}
    >
      <Box
        sx={{
          width: 34, height: 34, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: tone === 'positive' ? '#2E7D32' : '#C28A00',
          color: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: 11.5, fontWeight: 700, color: '#1F1F1F99', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </Box>
        {primary === undefined ? (
          <Skeleton variant="text" width="70%" height={22} />
        ) : (
          <Box sx={{ fontSize: 15, fontWeight: 800, color: '#1F1F1F' }}>{primary}</Box>
        )}
        <Box sx={{ fontSize: 11.5, color: '#1F1F1F99' }}>{secondary}</Box>
      </Box>
    </Box>
  )
}

/**
 * One row in the recent-activity feed. Movement types get consistent icon
 * + colour so the shop user learns to scan (green up = Receipt, red down =
 * Sale, etc.). Refund and Return share the same visual as "stock coming
 * back in" but the label distinguishes.
 */
function MovementRow({ m }: { m: ShopInventoryMovementDto }) {
  const style = MOVEMENT_STYLES[m.movementType]
  const isPositive = m.qtyDelta > 0
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.25,
        px: 1.5, py: 0.75,
        borderRadius: 1,
        borderBottom: '1px solid rgba(31,31,31,0.06)',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box
        sx={{
          width: 28, height: 28, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: style.bg, color: style.fg, flexShrink: 0,
        }}
      >
        {isPositive
          ? <ArrowUpRight   className="w-3.5 h-3.5" />
          : <ArrowDownRight className="w-3.5 h-3.5" />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F', display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <span>{m.productName}</span>
          <Chip
            size="small"
            label={style.label}
            sx={{
              height: 18, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              bgcolor: style.bg, color: style.fg,
              border: 'none',
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        </Box>
        <Box sx={{ fontSize: 11, color: '#1F1F1F99' }}>
          {m.productCode} · {formatIstDateTime(m.createdAt)}
          {m.createdByName ? ` · ${m.createdByName}` : ''}
        </Box>
      </Box>
      <Box
        sx={{
          fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap',
          color: isPositive ? '#2E7D32' : '#C62828',
        }}
      >
        {isPositive ? '+' : ''}{m.qtyDelta}
      </Box>
    </Box>
  )
}

// Colour mapping per movement type. Kept in one place so the feed stays
// consistent with any future widget that shows movement rows.
const MOVEMENT_STYLES: Record<MovementType, { label: string; bg: string; fg: string }> = {
  Opening:    { label: 'OPEN',   bg: '#E3F2FD', fg: '#0D47A1' },
  Receipt:    { label: 'IN',     bg: '#E8F5E9', fg: '#1B5E20' },
  Sale:       { label: 'SOLD',   bg: '#FFEBEE', fg: '#B71C1C' },
  Return:     { label: 'RETURN', bg: '#FFF3E0', fg: '#7C4A00' },
  Adjustment: { label: 'ADJUST', bg: '#F3E5F5', fg: '#4A148C' },
  Refund:     { label: 'REFUND', bg: '#E8F5E9', fg: '#1B5E20' },
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <Box sx={{ mt: 1.5, py: 3, textAlign: 'center' }}>
      <Box sx={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F' }}>{message}</Box>
      {hint && <Box sx={{ mt: 0.5, fontSize: 12, color: '#1F1F1F99' }}>{hint}</Box>}
    </Box>
  )
}
