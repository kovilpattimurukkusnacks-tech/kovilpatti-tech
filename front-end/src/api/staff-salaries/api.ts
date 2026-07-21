import { apiClient } from '../client'
import type {
  StaffSalaryRowDto, StaffSalaryDto, SetStaffSalaryRequest, PaySalaryRequest, DeductSalaryRequest,
} from './types'

export const staffSalariesApi = {
  list: (from: string, to: string) =>
    apiClient.get<StaffSalaryRowDto[]>(`/api/staff-salaries?from=${from}&to=${to}`),
  set: (req: SetStaffSalaryRequest) =>
    apiClient.post<StaffSalaryDto>('/api/staff-salaries/set', req),
  pay: (req: PaySalaryRequest) =>
    apiClient.post<void>('/api/staff-salaries/pay', req),
  deduct: (req: DeductSalaryRequest) =>
    apiClient.post<void>('/api/staff-salaries/deduct', req),
}
