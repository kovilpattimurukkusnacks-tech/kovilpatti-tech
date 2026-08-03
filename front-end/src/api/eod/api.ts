import { apiClient } from '../client'
import type { EodCloseRequest, EodExpectedDto, EodSessionListItemDto } from './types'

export const eodApi = {
  expected: (from?: string, to?: string) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to)   p.set('to', to)
    const qs = p.toString()
    return apiClient.get<EodExpectedDto>(`/api/eod/expected${qs ? `?${qs}` : ''}`)
  },
  close: (req: EodCloseRequest) =>
    apiClient.post<{ id: string }>('/api/eod/close', req),
  recent: (limit = 10) =>
    apiClient.get<EodSessionListItemDto[]>(`/api/eod/recent?limit=${limit}`),
}
