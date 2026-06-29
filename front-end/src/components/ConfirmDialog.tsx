import { AlertTriangle } from 'lucide-react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import './ConfirmDialog.css'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  onConfirm, onCancel,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick') return
        onCancel()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle className="confirm-dialog-title">
        <Box className="confirm-dialog-icon-circle">
          <AlertTriangle className="w-5 h-5" />
        </Box>
        {title}
      </DialogTitle>
      <DialogContent>
        <p className="text-sm text-[#5D4037]">{message}</p>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={onCancel}
          variant="outlined"
          sx={{
            textTransform: 'none', fontWeight: 600,
            borderColor: '#1F1F1F', color: '#1F1F1F',
            '&:hover': { borderColor: '#1F1F1F', bgcolor: '#FCD835' },
          }}
        >
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} variant="contained" color="error" sx={{ textTransform: 'none', fontWeight: 600 }}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
