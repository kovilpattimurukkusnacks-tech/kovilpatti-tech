import { Alert, Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { useShopInventoryProductMovements } from '../../hooks/useShopInventory'
import { MOVEMENT_LABEL } from './stockLabels'
import { formatIstDateTime } from '../../utils/formatDate'
import { DetailDialog } from '../sales/salesUi'
import { GAIN_GREEN, LOSS_RED } from '../sales/salesTheme'

/** Last 100 stock movements of one product at one shop. */
export default function ProductMovementsDialog({ shopId, product, onClose }: {
  shopId: string
  product: { id: string; label: string } | null
  onClose: () => void
}) {
  const q = useShopInventoryProductMovements(product?.id, { shopId, pageSize: 100 })
  return (
    <DetailDialog open={!!product} onClose={onClose} title={product ? `Stock history — ${product.label}` : 'Stock history'}>
      {q.isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>}
      {q.isError && <Alert severity="error">{q.error instanceof Error ? q.error.message : 'Failed to load history.'}</Alert>}
      {q.data && (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#FCD835' }}>
              <TableCell sx={{ fontWeight: 800 }}>When</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>What</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Note</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>By</TableCell>
              <TableCell sx={{ fontWeight: 800 }} align="right">Change</TableCell>
              <TableCell sx={{ fontWeight: 800 }} align="right">Stock after</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {q.data.length === 0 && <TableRow><TableCell colSpan={6} sx={{ opacity: 0.6 }}>No movements yet.</TableCell></TableRow>}
            {q.data.map(m => (
              <TableRow key={m.id}>
                <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatIstDateTime(m.createdAt)}</TableCell>
                <TableCell>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}</TableCell>
                <TableCell sx={{ fontSize: 12 }}>{m.note ?? ''}</TableCell>
                <TableCell>{m.createdByName ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: m.qtyDelta < 0 ? LOSS_RED : GAIN_GREEN }}>
                  {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{m.qtyAfter}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DetailDialog>
  )
}
