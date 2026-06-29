import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '../api/settings/api'
import type { AppSettingDto, UpdateAppSettingRequest } from '../api/settings/types'

export const settingsKeys = {
  all: ['settings'] as const,
  detail: (key: string) => ['settings', key] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => settingsApi.list(),
  })
}

/**
 * Convenience hook for the global "GST tracking" master switch
 * (19-Jun-2026, client #15). Wraps useSettings — same cache, no extra
 * network call.
 *
 *   • Returns `enabled = false` while loading so UI defaults to hiding
 *     the GST input until we know for sure (safer than showing-then-
 *     hiding which flickers).
 *   • Returns `enabled = false` when the setting row is missing too —
 *     fresh DBs without the seed row should not surface GST UI.
 *
 * Toggling: call the regular useUpdateSetting() with key='gst_enabled'
 * and value='true' | 'false'. The list-query cache update there will
 * flow through to this hook automatically.
 */
export function useGstEnabled(): { enabled: boolean; isLoading: boolean } {
  const q = useSettings()
  const enabled = useMemo(() => {
    const row = q.data?.find(s => s.key === 'gst_enabled')
    return row?.value?.toLowerCase() === 'true'
  }, [q.data])
  return { enabled, isLoading: q.isLoading }
}

export function useUpdateSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, req }: { key: string; req: UpdateAppSettingRequest }) =>
      settingsApi.update(key, req),
    onSuccess: (updated) => {
      // Patch detail cache + patch the list cache in place
      qc.setQueryData(settingsKeys.detail(updated.key), updated)
      qc.setQueryData<AppSettingDto[]>(settingsKeys.all, (old) =>
        old ? old.map(s => s.key === updated.key ? updated : s) : old)
    },
  })
}
