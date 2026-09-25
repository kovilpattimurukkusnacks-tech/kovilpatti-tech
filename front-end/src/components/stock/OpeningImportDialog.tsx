import { useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import { Download, Upload } from 'lucide-react'
import { useImportOpeningStock } from '../../hooks/useShopInventory'
import type { OpeningImportResultDto } from '../../api/shop-inventory/types'
import { CREAM, GAIN_GREEN, LOSS_RED } from '../sales/salesTheme'

const TEMPLATE = 'code,qty,unit_cost\nP001,24,\nP002,10.5,\n'

/**
 * Opening stock import for one shop (feature #3). Two steps:
 *   1. Upload → PREVIEW (nothing saved): every row shows current → new
 *      on-hand, or why it can't be used.
 *   2. Apply — only enabled when the preview has zero errors. Server re-
 *      checks and applies all rows in one transaction (all or nothing).
 * The qty is the COUNTED stock (absolute), not an amount to add. Products
 * not in the file keep their current stock.
 * Mount only while open (the parent does) so each open starts fresh.
 */
export default function OpeningImportDialog({ shopId, shopName, onClose, onDone }: {
  shopId: string
  shopName: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<OpeningImportResultDto | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const importer = useImportOpeningStock()

  const run = async (dryRun: boolean, f: File) => {
    setErr(null)
    try {
      const res = await importer.mutateAsync({ file: f, shopId, dryRun })
      setResult(res)
      if (res.applied) onDone(`Opening stock saved for ${shopName}: ${res.changedCount} product${res.changedCount === 1 ? '' : 's'} updated.`)
    } catch (e) {
      setResult(null)
      setErr(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  const pick = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    void run(true, f)
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'opening_stock_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const canApply = !!file && !!result && !result.applied && result.errorCount === 0 && result.changedCount > 0

  return (
    <Dialog
      open
      onClose={(_e, r) => { if (r === 'backdropClick' || r === 'escapeKeyDown') return; onClose() }}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: CREAM, border: '2px solid #1F1F1F' } } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>Import opening stock — {shopName}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="info">
          Upload an Excel (.xlsx) or CSV with columns <strong>code</strong>, <strong>qty</strong> and optionally{' '}
          <strong>unit_cost</strong>. <strong>qty</strong> is the stock you <em>counted</em> — the shop's on-hand is
          set to exactly this number. Products not in the file are not changed. <strong>code</strong> can be the
          product code (P001) or its barcode.
        </Alert>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="outlined" startIcon={<Download size={16} />} onClick={downloadTemplate}
            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: CREAM }}>
            Download template
          </Button>
          <Button variant="outlined" startIcon={<Upload size={16} />} onClick={() => inputRef.current?.click()}
            disabled={importer.isPending} sx={{ textTransform: 'none', fontWeight: 700, bgcolor: CREAM }}>
            {file ? 'Choose a different file' : 'Choose file'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }}
          />
          {file && <Typography variant="body2" sx={{ fontWeight: 700 }}>{file.name}</Typography>}
          {importer.isPending && <Typography variant="body2">Checking…</Typography>}
        </Box>

        {err && <Alert severity="error">{err}</Alert>}

        {result && (
          <>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={`${result.changedCount} will change`} sx={{ fontWeight: 700 }} color={result.changedCount ? 'warning' : 'default'} />
              <Chip label={`${result.unchangedCount} already correct`} sx={{ fontWeight: 700 }} />
              <Chip label={`${result.errorCount} error${result.errorCount === 1 ? '' : 's'}`} sx={{ fontWeight: 700 }}
                color={result.errorCount ? 'error' : 'default'} />
            </Box>
            {result.applied
              ? <Alert severity="success">Saved. The shop's stock has been updated.</Alert>
              : result.errorCount > 0
                ? <Alert severity="warning">Nothing has been saved. Fix the rows marked as errors in your file and choose it again.</Alert>
                : result.changedCount === 0
                  ? <Alert severity="info">Every product in the file already has this stock — nothing to change.</Alert>
                  : <Alert severity="info">Preview only — nothing saved yet. Check the numbers, then click <strong>Apply</strong>.</Alert>}

            <Box sx={{ maxHeight: 380, overflow: 'auto', border: '1.5px solid rgba(31,31,31,0.2)', borderRadius: 1.5 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {['Row', 'Code', 'Product', 'Current', 'New', 'Change', 'Status'].map(h => (
                      <TableCell key={h} sx={{ fontWeight: 800, bgcolor: '#FCD835' }}
                        align={['Current', 'New', 'Change'].includes(h) ? 'right' : 'left'}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.rows.map(r => (
                    <TableRow key={`${r.rowNo}-${r.inputCode}`} sx={r.status === 'Error' ? { bgcolor: '#FFEBEE' } : undefined}>
                      <TableCell>{r.rowNo}</TableCell>
                      <TableCell>{r.inputCode || '—'}</TableCell>
                      <TableCell>{r.productName ?? '—'}</TableCell>
                      <TableCell align="right">{r.currentQty ?? '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{r.newQty ?? '—'}</TableCell>
                      <TableCell align="right" sx={{
                        fontWeight: 700,
                        color: r.delta == null || r.delta === 0 ? undefined : r.delta < 0 ? LOSS_RED : GAIN_GREEN,
                      }}>
                        {r.delta == null ? '—' : r.delta > 0 ? `+${r.delta}` : r.delta}
                      </TableCell>
                      <TableCell sx={{ color: r.status === 'Error' ? LOSS_RED : undefined, fontWeight: r.status === 'Error' ? 700 : 500 }}>
                        {r.status === 'Error' ? r.message : r.status === 'Changed' ? 'Will change' : 'No change'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={importer.isPending} sx={{ textTransform: 'none', fontWeight: 700 }}>
          {result?.applied ? 'Close' : 'Cancel'}
        </Button>
        {!result?.applied && (
          <Button variant="contained" color="primary" disabled={!canApply || importer.isPending}
            onClick={() => file && run(false, file)} sx={{ textTransform: 'none', fontWeight: 700 }}>
            {importer.isPending ? 'Saving…' : `Apply ${result?.changedCount ?? 0} change${result?.changedCount === 1 ? '' : 's'}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
