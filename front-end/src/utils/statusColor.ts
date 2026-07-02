import type { RequestStatus } from '../api/stock-requests/types'

// Shared status → MUI Chip color mapping for stock requests. Used by both
// the admin and inventory list/detail pages so the color semantics stay
// identical across personas.
//
// 'Draft' requests are filtered out of every list/detail endpoint by the BE
// (neither admin nor inventory ever sees one) — the mapping is kept only to
// satisfy the exhaustive Record<RequestStatus, …> type.
//
// 'Accepted' is the Returns' terminal state — green-success once goods are
// back at godown.
export const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  Draft: 'default',
  Pending: 'warning', Approved: 'info', Rejected: 'error',
  Dispatched: 'primary', Received: 'success', Cancelled: 'default',
  Accepted: 'success',
}
