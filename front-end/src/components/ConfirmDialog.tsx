import { AlertTriangle } from 'lucide-react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import './ConfirmDialog.css'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  // While a confirm action is in flight, disable both buttons so a second
  // click can't fire a duplicate mutation. On failure, keep the dialog open
  // and show submitError instead of silently closing it — closing on error
  // looked identical to a successful delete/reset to the user.
  submitting?: boolean
  submitError?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  submitting = false, submitError = null,
  onConfirm, onCancel,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || submitting) return
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
        {submitError && <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-line' }}>{submitError}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onCancel} variant="outlined" color="secondary" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 500 }}>{cancelLabel}</Button>
        <Button onClick={onConfirm} variant="contained" color="error" disabled={submitting} sx={{ textTransform: 'none', fontWeight: 600 }}>
          {submitting ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
