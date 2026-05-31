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
