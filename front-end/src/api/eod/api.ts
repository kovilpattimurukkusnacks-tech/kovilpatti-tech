import { apiClient } from '../client'
import type { EodCloseRequest, EodExpectedDto, EodSessionListItemDto } from './types'

export const eodApi = {
  // Window is server-decided: previous close (or today's IST midnight) → now.
  expected: () => apiClient.get<EodExpectedDto>('/api/eod/expected'),
  close: (req: EodCloseRequest) =>
    apiClient.post<{ id: string }>('/api/eod/close', req),
  recent: (limit = 10) =>
    apiClient.get<EodSessionListItemDto[]>(`/api/eod/recent?limit=${limit}`),
}
