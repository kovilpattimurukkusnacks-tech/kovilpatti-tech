import { apiClient } from '../client'
import type { AppSettingDto, UpdateAppSettingRequest } from './types'

export const settingsApi = {
  list:   ()                                            => apiClient.get<AppSettingDto[]>('/api/settings'),
  get:    (key: string)                                 => apiClient.get<AppSettingDto>(`/api/settings/${encodeURIComponent(key)}`),
  update: (key: string, req: UpdateAppSettingRequest)   => apiClient.put<AppSettingDto>(`/api/settings/${encodeURIComponent(key)}`, req),
}
