import { useEffect, useMemo, useState, useRef } from 'react'
import { Search, ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  Box, Button, Checkbox, Chip, ClickAwayListener, IconButton,
  InputAdornment, Paper, Popper, TextField,
} from '@mui/material'
import type { CategoryDto } from '../api/categories/types'

/**
 * Advanced categories multi-select — a collapsible tree Popper triggered
 * by a text-field-shaped button in the parent's filter bar.
 *
 * Layout:
 *   [ Trigger button ]          ← looks like a TextField; shows "N selected"
 *      ↓ click
 *   ┌─────────────────────┐
 *   │ 🔍 Search…          │    ← always visible at top; filters the tree
 *   ├─────────────────────┤
 *   │ ▼ 1 KG SNACKS       │    ← click header → expand/collapse
 *   │    ☐ Chips 300      │
 *   │    ☑ Regular Rs.300 │    ← only LEAVES are selectable
 *   │    ☐ Special Rs.340 │
 *   │ ▶ PACKING ITEMS     │
 *   │ ▶ BISCUITS          │
 *   └─────────────────────┘
 *
 * All state (search, expanded set) is component-local; only the selected
 * category-id list is lifted to the parent via onChange. Search auto-
 * expands any root whose leaves match.
 */
export function CategoryTreeFilter({
  categories,
  value,
  onChange,
  placeholder = 'Categories',
  minWidth = 240,
  maxWidth = 360,
}: {
  categories: CategoryDto[]
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  minWidth?: number
  maxWidth?: number
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  // Reset transient popper state (search text + which roots are expanded)
  // whenever the popper closes, so the next open starts clean. Without
  // this, a stale search from the previous session filters the tree on
  // reopen — which the client flagged as confusing (01-Jul-2026).
  useEffect(() => {
    if (!open) {
      setSearch('')
      setExpanded(new Set())
    }
  }, [open])

  // Build root → children groups from the flat categories list. Roots are
  // categories with parentId === null; children are direct descendants.
  // If the data has depth > 2, deeper descendants get flattened under
  // their immediate parent (rare — most tenants have root + leaf only).
  const groups = useMemo(() => {
    const roots = categories.filter(c => c.parentId == null).sort((a, b) => a.name.localeCompare(b.name))
    return roots.map(root => {
      const children = categories
        .filter(c => c.parentId === root.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      return { root, children }
    })
  }, [categories])

  // Search filter — case-insensitive substring match on category names.
  //   • Root name matches  → show root + ALL its children (user is
  //     browsing that root; hiding children would be confusing).
  //   • Root doesn't match but some children do → show root + only the
  //     matching children.
  //   • Neither matches → group hidden.
  // When search is non-empty, groups auto-expand so hits are visible.
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.reduce<{ root: CategoryDto; children: CategoryDto[] }[]>((acc, { root, children }) => {
      const rootMatch     = root.name.toLowerCase().includes(q)
      const childMatches  = children.filter(c => c.name.toLowerCase().includes(q))
      if (rootMatch) {
        // Root hit → keep ALL children unfiltered.
        acc.push({ root, children })
      } else if (childMatches.length > 0) {
        // Only some children hit → show them, root as their header.
        acc.push({ root, children: childMatches })
      }
      return acc
    }, [])
  }, [groups, search])

  const selectedSet = useMemo(() => new Set(value), [value])

  const toggleLeaf = (id: number) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }

  const toggleExpand = (rootId: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  const clearAll = () => onChange([])

  const selectedCount = value.length
  // While searching we force-expand every visible root so hits show up.
  const isSearching = search.trim().length > 0

  return (
    <>
      {/* Trigger — styled to look like a small TextField so the filter
          bar reads as one row of controls. */}
      <Box
        ref={anchorRef}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth,
          maxWidth,
          flex: 1,
          height: 40,
          px: 1.25,
          // Fully rounded pill corners (client req 01-Jul-2026).
          borderRadius: 999,
          border: '1px solid rgba(31,31,31,0.23)',
          bgcolor: '#FFFBE6',
          cursor: 'pointer',
          fontSize: 14,
          color: selectedCount > 0 ? '#1F1F1F' : 'rgba(31,31,31,0.55)',
          '&:hover': { borderColor: '#1F1F1F' },
          userSelect: 'none',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {selectedCount === 0 ? placeholder : (
            <Chip
              size="small"
              label={`${selectedCount} selected`}
              sx={{ bgcolor: '#FCD835', fontWeight: 700 }}
            />
          )}
        </Box>
        {selectedCount > 0 && (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); clearAll() }}
            aria-label="Clear selected categories"
            sx={{ p: 0.25 }}
          >
            <X className="w-3.5 h-3.5" />
          </IconButton>
        )}
        <ChevronDown className="w-4 h-4" style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} />
      </Box>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        style={{ zIndex: 1300 }}
      >
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <Paper
            elevation={4}
            sx={{
              mt: 0.5,
              minWidth: anchorRef.current?.clientWidth ?? 260,
              maxWidth: 380,
              maxHeight: 420,
              overflow: 'hidden',
              // Cream to match the filter strip behind it (client req
              // 01-Jul-2026). List rows below inherit the same tone so
              // the dropdown reads as an extension of the strip, not a
              // separate white panel floating above it.
              bgcolor: '#FFFBE6',
              border: '2px solid #1F1F1F',
              borderRadius: 1.5,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Sticky search input at the top. */}
            <Box sx={{ p: 1, borderBottom: '1px solid rgba(31,31,31,0.12)', bgcolor: '#FFFBE6' }}>
              <TextField
                size="small"
                fullWidth
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search categories…"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search className="w-4 h-4 text-[#1F1F1F]/70" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear search">
                          <X className="w-3.5 h-3.5" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#FFFBE6' } }}
              />
            </Box>

            {/* Scrollable tree body. Empty state when the search filter
                eliminates every group. */}
            <Box sx={{ overflowY: 'auto', flex: 1, py: 0.5 }}>
              {filteredGroups.length === 0 ? (
                <Box sx={{ px: 2, py: 3, textAlign: 'center', color: '#1F1F1F99', fontSize: 13 }}>
                  No categories match "{search}".
                </Box>
              ) : filteredGroups.map(({ root, children }, groupIdx) => {
                const isOpen = isSearching || expanded.has(root.id)
                const selectedInGroup = children.filter(c => selectedSet.has(c.id)).length
                return (
                  <Box key={root.id}>
                    <Box
                      onClick={() => !isSearching && toggleExpand(root.id)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.25,
                        py: 0.75,
                        cursor: isSearching ? 'default' : 'pointer',
                        userSelect: 'none',
                        fontWeight: 700,
                        fontSize: 13,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: '#1F1F1F',
                        bgcolor: 'rgba(31,31,31,0.03)',
                        // First section's top border is dropped — the search
                        // input above already draws a bottom border, so
                        // stacking both showed as a double line (client
                        // flagged 01-Jul-2026). Subsequent sections keep
                        // their top border for visual separation.
                        borderTop: groupIdx === 0 ? 'none' : '1px solid rgba(31,31,31,0.06)',
                        '&:hover': { bgcolor: isSearching ? undefined : 'rgba(31,31,31,0.07)' },
                      }}
                    >
                      {isOpen
                        ? <ChevronDown className="w-4 h-4" style={{ opacity: 0.6 }} />
                        : <ChevronRight className="w-4 h-4" style={{ opacity: 0.6 }} />}
                      <Box sx={{ flex: 1 }}>{root.name}</Box>
                      {selectedInGroup > 0 && (
                        <Chip
                          size="small"
                          label={`${selectedInGroup}/${children.length}`}
                          sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: '#FCD835' }}
                        />
                      )}
                    </Box>
                    {isOpen && children.map(leaf => {
                      const isSelected = selectedSet.has(leaf.id)
                      return (
                        <Box
                          key={leaf.id}
                          onClick={() => toggleLeaf(leaf.id)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            pl: 3.5,
                            pr: 1.25,
                            py: 0.5,
                            fontSize: 13,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(31,31,31,0.04)' },
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            size="small"
                            sx={{ p: 0.5 }}
                            tabIndex={-1}
                          />
                          <span>{leaf.name}</span>
                        </Box>
                      )
                    })}
                    {/* A root with zero children (rare but possible) is still
                        selectable when expanded — treat the root itself as a
                        leaf in that case. */}
                    {isOpen && children.length === 0 && (
                      <Box
                        onClick={() => toggleLeaf(root.id)}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 0.5,
                          pl: 3.5, pr: 1.25, py: 0.5, fontSize: 13, cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(31,31,31,0.04)' },
                        }}
                      >
                        <Checkbox
                          checked={selectedSet.has(root.id)}
                          size="small"
                          sx={{ p: 0.5 }}
                          tabIndex={-1}
                        />
                        <span style={{ fontStyle: 'italic', color: '#1F1F1F99' }}>{root.name} (self)</span>
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>

            {/* Footer with a "Clear all" quick action + close. */}
            <Box sx={{
              px: 1.25, py: 0.75, borderTop: '1px solid rgba(31,31,31,0.12)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#FFFBE6',
            }}>
              <Button
                size="small"
                onClick={clearAll}
                disabled={selectedCount === 0}
                sx={{ textTransform: 'none', fontSize: 12, color: '#1F1F1F' }}
              >
                Clear all
              </Button>
              <Button
                size="small"
                onClick={() => setOpen(false)}
                sx={{ textTransform: 'none', fontSize: 12, fontWeight: 700, color: '#1F1F1F' }}
              >
                Done
              </Button>
            </Box>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  )
}
