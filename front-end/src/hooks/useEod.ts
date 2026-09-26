import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eodApi } from '../api/eod/api'
import type { EodCloseRequest } from '../api/eod/types'

export const eodKeys = {
  all: ['eod'] as const,
  expected: ['eod', 'expected'] as const,
  recent: (limit: number) => ['eod', 'recent', limit] as const,
}

/** Expected tender snapshot. Auto-refresh every 15s so a cashier who leaves
 *  the dialog open picks up bills issued in the meantime. The window is
 *  server-decided (previous close → now), the same one the close records. */
export function useEodExpected(enabled = true) {
  return useQuery({
    queryKey: eodKeys.expected,
    queryFn: () => eodApi.expected(),
    enabled,
    refetchInterval: 15_000,
  })
}

export function useEodRecent(limit = 10) {
  return useQuery({
    queryKey: eodKeys.recent(limit),
    queryFn: () => eodApi.recent(limit),
  })
}

export function useCloseEod() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: EodCloseRequest) => eodApi.close(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eodKeys.all })
    },
  })
}
