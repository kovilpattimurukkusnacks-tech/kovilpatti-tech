import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eodApi } from '../api/eod/api'
import type { EodCloseRequest } from '../api/eod/types'

export const eodKeys = {
  all: ['eod'] as const,
  expected: (from?: string, to?: string) => ['eod', 'expected', from ?? null, to ?? null] as const,
  recent: (limit: number) => ['eod', 'recent', limit] as const,
}

/** Expected tender snapshot. Auto-refresh every 15s so a cashier who leaves
 *  the dialog open picks up bills issued in the meantime. */
export function useEodExpected(from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: eodKeys.expected(from, to),
    queryFn: () => eodApi.expected(from, to),
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
