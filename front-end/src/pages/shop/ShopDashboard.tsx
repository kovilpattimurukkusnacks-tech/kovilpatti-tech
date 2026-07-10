import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight,
  ClipboardCheck, ClipboardList, FolderTree, Package, Sparkles, TrendingUp, Wallet,
} from 'lucide-react'
import { Alert, Box, Chip, Paper, Skeleton } from '@mui/material'
import PageHeader from '../../components/PageHeader'
import { useShopDashboard, useShopInventoryTree } from '../../hooks/useShopInventory'
import { useCategories } from '../../hooks/useCategories'
import type { ShopInventoryTreeItemDto } from '../../api/shop-inventory/types'
import type { CategoryDto } from '../../api/categories/types'
import { formatINR } from '../../utils/format'
import { formatIstDateTime } from '../../utils/formatDate'

/**
 * Shop user's post-login landing page (see project_kovilpatti_shop_landing
 * memory). Pulls one aggregated payload from GET /api/shop-dashboard.
 * Widgets are gated by data — empty states render inline where the shop
 * hasn't built up any activity yet.
 */
export default function ShopDashboard() {
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
      {/* Read-only showcase page — no action buttons. Shop user navigates
          to other flows via the sidebar. Do not add action props here. */}
      <PageHeader
        title="Dashboard"
        subtitle={
          isLoading
            ? 'Loading…'
            : data
              ? `${data.shopName} · ${data.shopCode}`
              : undefined
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
                      {/* Breadcrumb in bold above the product name so the
                          shop user immediately sees WHERE the low item
                          sits (root category > sub-category). Falls back
                          to leaf name if path is null, then hides
                          entirely if both are gone. */}
                      {(item.categoryPath || item.categoryName) && (
                        <Box
                          sx={{
                            fontSize: 10.5, fontWeight: 800,
                            color: '#7C4A00',
                            textTransform: 'uppercase', letterSpacing: 0.4,
                            lineHeight: 1.3, mb: 0.25,
                          }}
                        >
                          {item.categoryPath ?? item.categoryName}
                        </Box>
                      )}
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

      {/* ─── Inventory by category tree ───
          Expandable browse of stock rolled up through the category tree:
              Root categories → sub-categories → individual products.
          Right side shows the rolled-up qty at every level. Data comes from
          fn_shop_inventory_tree (slim, unpaginated) + the existing categories
          list; rollups happen client-side in buildInventoryTree(). */}
      <InventoryByCategorySection />
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

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <Box sx={{ mt: 1.5, py: 3, textAlign: 'center' }}>
      <Box sx={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F' }}>{message}</Box>
      {hint && <Box sx={{ mt: 0.5, fontSize: 12, color: '#1F1F1F99' }}>{hint}</Box>}
    </Box>
  )
}

// ═══════════════ Inventory-by-category tree ═══════════════
//
// Fetches two independent lists and joins client-side:
//   • useCategories()          → full category tree (id, parentId, depth)
//   • useShopInventoryTree()   → slim (product, category_id, on_hand, mrp)
//
// buildInventoryTree() folds them into a nested TreeNode structure with
// qty rolled up through every node. Empty branches (no products with
// stock in any descendant) are pruned so the tree isn't cluttered with
// noise categories that don't apply to this shop yet.

type ProductLine = {
  productId:   string
  productCode: string
  productName: string
  onHand:      number
  mrp:         number
}

type TreeNode = {
  categoryId:   number
  name:         string
  depth:        number
  children:     TreeNode[]
  products:     ProductLine[]      // products directly under this category
  totalQty:     number             // rolled up across the entire subtree
  productCount: number             // rolled up across the entire subtree
}

function InventoryByCategorySection() {
  const catsQuery = useCategories()
  const invQuery  = useShopInventoryTree()

  const tree = useMemo(
    () => {
      const cats = catsQuery.data ?? []
      const inv  = invQuery.data  ?? []
      return buildInventoryTree(cats, inv)
    },
    [catsQuery.data, invQuery.data],
  )

  const isLoading = catsQuery.isLoading || invQuery.isLoading
  const isError   = catsQuery.isError   || invQuery.isError

  return (
    <Paper elevation={0} sx={panelSx}>
      <SectionHeader
        icon={<FolderTree className="w-4 h-4" />}
        title="Inventory by category"
        trailing={
          !isLoading && tree.length > 0 ? (
            <Chip
              size="small"
              label={`${tree.reduce((n, r) => n + r.productCount, 0)} items`}
              sx={{
                borderRadius: 999, fontWeight: 700, fontSize: 11,
                bgcolor: '#FFF8E1', color: '#7C4A00',
                border: '1px solid rgba(194,138,0,0.35)',
              }}
            />
          ) : undefined
        }
      />

      {isError ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          Failed to load inventory tree.
        </Alert>
      ) : isLoading ? (
        <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
          ))}
        </Box>
      ) : tree.length === 0 ? (
        <EmptyState
          message="No inventory yet."
          hint="Once the godown dispatches goods and you confirm receipt, categories with stock will appear here."
        />
      ) : (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {tree.map(node => (
            <TreeRow key={node.categoryId} node={node} depth={0} />
          ))}
        </Box>
      )}
    </Paper>
  )
}

/**
 * One recursive row. Renders:
 *   • Header (indented by depth) with category name + total qty + chevron
 *   • On expand: child category rows (recursion) + direct products in this
 *     node (leaf lines at depth+1)
 * Depth-based padding gives a visual hierarchy without heavy tree lines.
 */
function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(false)

  const hasChildren = node.children.length > 0 || node.products.length > 0
  const indent      = depth * 20        // 20px per level — feels balanced at 3 levels
  const isRoot      = depth === 0

  // Root nodes get the amber background + stronger border so they read
  // as top-level buckets. Deeper nodes are quieter cream stripes.
  const rowSx = isRoot
    ? {
        bgcolor: '#FFF8E1',
        border: '1px solid rgba(194,138,0,0.35)',
        fontWeight: 800,
      }
    : {
        bgcolor: '#FFFBE6',
        border: '1px solid rgba(31,31,31,0.08)',
        fontWeight: 700,
      }

  return (
    <>
      <Box
        role="button"
        tabIndex={hasChildren ? 0 : -1}
        onClick={() => hasChildren && setOpen(o => !o)}
        onKeyDown={(e) => {
          if (!hasChildren) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
        }}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          pl: `${indent + 10}px`, pr: 1.5, py: 1,
          borderRadius: 1,
          cursor: hasChildren ? 'pointer' : 'default',
          userSelect: 'none',
          transition: 'background-color 120ms',
          '&:hover': hasChildren ? { bgcolor: '#FFF4B8' } : undefined,
          ...rowSx,
        }}
      >
        {hasChildren ? (
          open
            ? <ChevronDown  className="w-4 h-4 text-[#1F1F1F]" />
            : <ChevronRight className="w-4 h-4 text-[#1F1F1F]" />
        ) : (
          <Box sx={{ width: 16 }} />        // spacer to keep names aligned
        )}
        <Box sx={{ flex: 1, minWidth: 0, fontSize: isRoot ? 14 : 13, color: '#1F1F1F' }}>
          {node.name}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Box sx={{ fontSize: 11.5, color: '#1F1F1F99', fontWeight: 500 }}>
            {node.productCount} {node.productCount === 1 ? 'item' : 'items'}
          </Box>
          <Box
            sx={{
              fontSize: isRoot ? 15 : 14,
              fontWeight: 800,
              color: node.totalQty > 0 ? '#1F1F1F' : '#1F1F1F55',
              minWidth: 60, textAlign: 'right',
            }}
          >
            {node.totalQty}
          </Box>
        </Box>
      </Box>

      {open && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {/* Child categories first — recursion at depth+1 */}
          {node.children.map(child => (
            <TreeRow key={`c${child.categoryId}`} node={child} depth={depth + 1} />
          ))}
          {/* Then products directly under this category */}
          {node.products.map(p => (
            <ProductLeafRow
              key={`p${p.productId}`}
              product={p}
              depth={depth + 1}
            />
          ))}
        </Box>
      )}
    </>
  )
}

function ProductLeafRow({ product, depth }: { product: ProductLine; depth: number }) {
  const isOut = product.onHand <= 0
  const indent = depth * 20
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75,
        pl: `${indent + 30}px`, pr: 1.5, py: 0.75,      // +30 = past the chevron slot
        borderRadius: 1,
        bgcolor: isOut ? '#FFEBEE' : '#FFFFFF00',       // transparent — inherits panel bg
        border: isOut ? '1px dashed rgba(198,40,40,0.3)' : '1px solid rgba(31,31,31,0.04)',
      }}
    >
      <Package className="w-3.5 h-3.5 text-[#1F1F1F]/50" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: 12.5, fontWeight: 600, color: '#1F1F1F', lineHeight: 1.3 }}>
          {product.productName}
        </Box>
        <Box sx={{ fontSize: 10.5, color: '#1F1F1F99' }}>
          {product.productCode} · MRP {formatINR(product.mrp)}
        </Box>
      </Box>
      <Box
        sx={{
          fontSize: 13,
          fontWeight: 700,
          minWidth: 60,
          textAlign: 'right',
          color: isOut ? '#C62828' : '#1F1F1F',
        }}
      >
        {product.onHand}
      </Box>
    </Box>
  )
}

/**
 * Fold a flat category list + product list into a nested rooted-tree with
 * qty + productCount rolled up through every node. Categories that end
 * up with 0 products in their entire subtree are pruned (dead branches
 * that don't apply to this shop yet). Inactive categories are excluded
 * upfront so the tree matches what the shop can actually order.
 */
function buildInventoryTree(
  categories: CategoryDto[],
  products: ShopInventoryTreeItemDto[],
): TreeNode[] {
  // Skip inactive categories — same as any other browse UI.
  const activeCats = categories.filter(c => c.active)

  // productsByCategory[catId] = ProductLine[]
  const productsByCategory = new Map<number, ProductLine[]>()
  for (const p of products) {
    const line: ProductLine = {
      productId:   p.productId,
      productCode: p.productCode,
      productName: p.productName,
      onHand:      p.onHand,
      mrp:         p.mrp,
    }
    const arr = productsByCategory.get(p.categoryId)
    if (arr) arr.push(line)
    else productsByCategory.set(p.categoryId, [line])
  }

  // Build a node per category with empty children/products, then link up.
  const nodesById = new Map<number, TreeNode>()
  for (const c of activeCats) {
    nodesById.set(c.id, {
      categoryId:   c.id,
      name:         c.name,
      depth:        c.depth,
      children:     [],
      products:     (productsByCategory.get(c.id) ?? []).sort(
        (a, b) => a.productName.localeCompare(b.productName)),
      totalQty:     0,       // rolled up below
      productCount: 0,       // rolled up below
    })
  }

  // Attach children to parents. Categories whose parent is missing / inactive
  // are treated as roots — safer than dropping them silently.
  const roots: TreeNode[] = []
  for (const c of activeCats) {
    const node = nodesById.get(c.id)!
    if (c.parentId != null && nodesById.has(c.parentId)) {
      nodesById.get(c.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Recursive DFS to fill totalQty + productCount. Also prunes dead
  // branches — a category whose subtree has 0 products is not returned.
  const walk = (nodes: TreeNode[]): TreeNode[] => {
    const kept: TreeNode[] = []
    for (const n of nodes) {
      // Recurse first — child rollups feed into this node's totals.
      n.children = walk(n.children)

      const childQty   = n.children.reduce((s, c) => s + c.totalQty, 0)
      const childCount = n.children.reduce((s, c) => s + c.productCount, 0)
      const ownQty     = n.products.reduce((s, p) => s + p.onHand, 0)
      const ownCount   = n.products.length

      n.totalQty     = childQty + ownQty
      n.productCount = childCount + ownCount

      if (n.productCount > 0) kept.push(n)
      // else prune — no stock, no children with stock; nothing to show
    }
    // Stable sort roots + child rows by name so the tree order is
    // predictable across renders (server returns tree order but
    // pruning can shuffle it).
    kept.sort((a, b) => a.name.localeCompare(b.name))
    return kept
  }

  return walk(roots)
}
