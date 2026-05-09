import { apiClient } from '../client'
import type { LoginRequest, LoginResponse } from './types'

export const authApi = {
  login: (req: LoginRequest) => apiClient.post<LoginResponse>('/api/auth/login', req),
}
