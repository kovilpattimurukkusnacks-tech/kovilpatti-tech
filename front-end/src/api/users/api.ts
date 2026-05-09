import { apiClient } from '../client'
import type {
  UserDto, CreateStaffRequest, UpdateStaffRequest, ResetPasswordRequest,
} from './types'

export const usersApi = {
  list:          ()                                                => apiClient.get<UserDto[]>('/api/users'),
  get:           (id: string)                                      => apiClient.get<UserDto>(`/api/users/${id}`),
  create:        (req: CreateStaffRequest)                         => apiClient.post<UserDto>('/api/users', req),
  update:        (id: string, req: UpdateStaffRequest)             => apiClient.put<UserDto>(`/api/users/${id}`, req),
  resetPassword: (id: string, req: ResetPasswordRequest)           => apiClient.put<void>(`/api/users/${id}/password`, req),
  remove:        (id: string)                                      => apiClient.delete<void>(`/api/users/${id}`),
}
