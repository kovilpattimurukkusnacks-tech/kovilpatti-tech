import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Edit2, Trash2, X, Tag, ArrowLeft, ChevronDown, ChevronRight, FolderPlus,
} from 'lucide-react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import PageHeader from '../components/PageHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
} from '../hooks/useCategories'
import type { CategoryDto } from '../api/categories/types'
import { mutationErrorMessage } from '../utils/mutationError'
import './Products.css'

// Form modes — the 'create' branch carries an optional parent so the per-node
// "Add child" action can pre-seed the parent picker. 'closed' keeps the
// dialog dismounted so its internal state resets cleanly on next open.
type FormMode =
  | { kind: 'closed' }
  | { kind: 'create'; parent: CategoryDto | null }
  | { kind: 'edit';   category: CategoryDto }

type FormValues = {
  name:     string
  parentId: number | null
  active:   boolean
}

// Reasonable indent step at each nesting level. Deep trees still stay readable.
const INDENT_PX = 22

export default function Categories() {
  const navigate = useNavigate()
  const list   = useCategories()
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const remove = useDeleteCategory()

  const [formMode,      setFormMode]      = useState<FormMode>({ kind: 'closed' })
  const [pendingDelete, setPendingDelete] = useState<CategoryDto | null>(null)
  const [deleteError,   setDeleteError]   = useState<string | null>(null)
  // Collapsed node IDs. Default: everything expanded (empty set) so admin
  // sees the whole tree on first load — they can collapse what they don't
  // care about. Set persists within the page mount; reset on remount.
  const [collapsed,     setCollapsed]     = useState<Set<number>>(new Set())

  const categories = list.data ?? []
  const total      = categories.length

  // Children-by-parent index — built once per render, drives both the tree
  // walker and the "has children" indicator on rows.
  const childrenOf = useMemo(() => {
    const map = new Map<number | null, CategoryDto[]>()
    for (const c of categories) {
      const list = map.get(c.parentId) ?? []
      list.push(c)
      map.set(c.parentId, list)
    }
    // Server already returns rows in path-sorted order, so siblings inside
    // each bucket are alphabetical without a second sort.
    return map
  }, [categories])

  // Flatten the tree into the visible row order, applying the collapse state.
  // A node's descendants are skipped when the node itself is in the
  // collapsed set. We walk root-first via the childrenOf index.
  const visibleRows = useMemo(() => {
    const out: CategoryDto[] = []
    const walk = (parentId: number | null) => {
      for (const node of childrenOf.get(parentId) ?? []) {
        out.push(node)
        if (!collapsed.has(node.id)) walk(node.id)
      }
    }
    walk(null)
    return out
  }, [childrenOf, collapsed])

  const toggleCollapse = (id: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const closeForm = () => setFormMode({ kind: 'closed' })

  const handleSave = async (values: FormValues) => {
    if (formMode.kind === 'edit') {
      await update.mutateAsync({
        id: formMode.category.id,
        req: { name: values.name, parentId: values.parentId, active: values.active },
      })
    } else if (formMode.kind === 'create') {
      await create.mutateAsync({
        name: values.name, parentId: values.parentId, active: values.active,
      })
    }
    closeForm()
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await remove.mutateAsync(pendingDelete.id)
      setPendingDelete(null)
      setDeleteError(null)
    } catch (e) {
      setDeleteError(mutationErrorMessage(e) ?? 'Failed to delete.')
    }
  }

  const errorMessage = list.isError
    ? (list.error instanceof Error ? list.error.message : 'Failed to load categories.')
    : null

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle={list.isLoading ? 'Loading…' : `${total} ${total === 1 ? 'category' : 'categories'}`}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate('/admin/products')}
              sx={{
                textTransform: 'none', fontWeight: 600,
                borderColor: '#1F1F1F', color: '#1F1F1F', bgcolor: '#FFFFFF',
                '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
              }}
            >
              Back to Products
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<Plus className="w-4 h-4" />}
              // Top button always creates a root category — per-node "Add
              // child" actions seed a parent inline.
              onClick={() => setFormMode({ kind: 'create', parent: null })}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Add Category
            </Button>
          </Box>
        }
      />

      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}

      <Paper elevation={0} sx={{ borderRadius: 2, border: '2px solid #1F1F1F', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FCD835' }}>
                <TableCell sx={HEAD_SX}>Name</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 130 }} align="center">Status</TableCell>
                <TableCell sx={{ ...HEAD_SX, width: 160 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.length === 0 && !list.isLoading && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ color: '#1F1F1F99', py: 4 }}>
                    No categories yet.
                  </TableCell>
                </TableRow>
              )}
              {visibleRows.map(row => {
                const kids       = childrenOf.get(row.id) ?? []
                const hasKids    = kids.length > 0
                const isCollapsed = collapsed.has(row.id)
                return (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ py: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: `${row.depth * INDENT_PX}px` }}>
                        {/* Chevron only on nodes that actually have children;
                            keeps the spacing column for leaves so the names
                            line up visually within a depth level. */}
                        {hasKids ? (
                          <IconButton
                            size="small"
                            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                            onClick={() => toggleCollapse(row.id)}
                            sx={{ p: 0.25 }}
                          >
                            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </IconButton>
                        ) : (
                          <Box sx={{ width: 28 }} />
                        )}
                        <Box sx={{ fontWeight: 600, fontSize: 14 }}>{row.name}</Box>
                        {hasKids && (
                          <Chip
                            label={kids.length}
                            size="small"
                            variant="outlined"
                            sx={{ ml: 1, height: 18, fontSize: 10, fontWeight: 700, color: '#1F1F1F99', borderColor: 'rgba(31,31,31,0.2)' }}
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={row.active ? 'Active' : 'Inactive'}
                        size="small"
                        variant={row.active ? 'filled' : 'outlined'}
                        color={row.active ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label="Add sub-category"
                        title="Add sub-category"
                        onClick={() => setFormMode({ kind: 'create', parent: row })}
                      >
                        <FolderPlus className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="Edit"
                        onClick={() => setFormMode({ kind: 'edit', category: row })}
                      >
                        <Edit2 className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="Delete"
                        color="error"
                        onClick={() => { setDeleteError(null); setPendingDelete(row) }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <CategoryFormDialog
        open={formMode.kind !== 'closed'}
        mode={formMode}
        allCategories={categories}
        submitting={create.isPending || update.isPending}
        submitError={mutationErrorMessage(create.error) ?? mutationErrorMessage(update.error)}
        onClose={closeForm}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete category"
        message={
          deleteError
            ? deleteError
            : `Are you sure you want to delete "${pendingDelete?.name ?? ''}"? This is blocked if any product or sub-category still uses it.`
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => { setPendingDelete(null); setDeleteError(null) }}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────

const HEAD_SX = {
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  fontSize: 11,
}

// Recursive descendant set for the edit mode — a category can't move under
// itself OR any of its own descendants (would create a cycle, which the DB
// trigger would reject anyway, but BE round-trip is wasteful).
function collectDescendantIds(rootId: number, all: CategoryDto[]): Set<number> {
  const childIdx = new Map<number, CategoryDto[]>()
  for (const c of all) {
    if (c.parentId == null) continue
    const list = childIdx.get(c.parentId) ?? []
    list.push(c)
    childIdx.set(c.parentId, list)
  }
  const out = new Set<number>()
  const walk = (id: number) => {
    for (const k of childIdx.get(id) ?? []) {
      out.add(k.id)
      walk(k.id)
    }
  }
  walk(rootId)
  return out
}

function CategoryFormDialog({
  open, mode, allCategories, submitting, submitError, onClose, onSave,
}: {
  open:           boolean
  mode:           FormMode
  allCategories:  CategoryDto[]
  submitting:     boolean
  submitError:    string | null
  onClose:        () => void
  onSave:         (values: FormValues) => Promise<void>
}) {
  const isEdit         = mode.kind === 'edit'
  const editing        = mode.kind === 'edit'   ? mode.category : null
  const seedParent     = mode.kind === 'create' ? mode.parent   : null

  const [name,     setName]     = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [active,   setActive]   = useState(true)
  const [err,      setErr]      = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setParentId(editing.parentId)
      setActive(editing.active)
    } else {
      setName('')
      setParentId(seedParent?.id ?? null)
      setActive(true)
    }
    setErr(null)
  }, [open, editing, seedParent])

  // Parent picker options. In edit mode, exclude the row itself + every
  // descendant so the admin can't accidentally create a cycle.
  const parentOptions = useMemo(() => {
    if (!editing) return allCategories
    const banned = new Set<number>([editing.id, ...collectDescendantIds(editing.id, allCategories)])
    return allCategories.filter(c => !banned.has(c.id))
  }, [allCategories, editing])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Enter a category name'); return }
    setErr(null)
    try {
      await onSave({ name: name.trim(), parentId, active })
    } catch {
      // surfaces via submitError prop
    }
  }

  const dialogTitle = isEdit
    ? 'Edit Category'
    : seedParent
      ? `Add sub-category under "${seedParent.name}"`
      : 'Add Category'

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
        onClose()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tag className="w-5 h-5" />
          {dialogTitle}
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting}><X className="w-4 h-4" /></IconButton>
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 50))}
            required
            size="small"
            autoFocus
            disabled={submitting}
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />

          {/* Parent picker. "(none — root category)" sentinel keeps Select
              controlled when parentId is null. Path label disambiguates
              when names repeat across branches. */}
          <FormControl size="small" fullWidth disabled={submitting}>
            <InputLabel id="parent-label">Parent</InputLabel>
            <Select
              labelId="parent-label"
              label="Parent"
              value={parentId == null ? '' : String(parentId)}
              onChange={e => setParentId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <MenuItem value=""><em>(none — root category)</em></MenuItem>
              {parentOptions.map(opt => (
                <MenuItem key={opt.id} value={String(opt.id)}>
                  {opt.path ?? opt.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Checkbox checked={active} onChange={e => setActive(e.target.checked)} disabled={submitting} sx={{ p: 0.5 }} />
            <Box component="span" sx={{ fontSize: 14, color: '#1F1F1F', userSelect: 'none' }}>Active</Box>
          </Box>
          {err && <Box sx={{ color: 'error.main', fontSize: 14 }}>{err}</Box>}
          {submitError && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{submitError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="outlined" color="secondary" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 500 }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
            {submitting ? 'Saving…' : (isEdit ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
