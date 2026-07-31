import { apiClient } from '../client'
import type { EwayBillDto, EwayInboundThresholdDto, RecordEwayBillRequest } from './types'

export const ewayBillsApi = {
  listForPurchase: (purchaseId: string) =>
    apiClient.get<EwayBillDto[]>(`/api/vendor-purchases/${purchaseId}/eway-bills`),

  record: (purchaseId: string, req: RecordEwayBillRequest) =>
    apiClient.post<EwayBillDto>(`/api/vendor-purchases/${purchaseId}/eway-bills`, req),

  cancel: (purchaseId: string, id: string, reason?: string) =>
    apiClient.post<void>(`/api/vendor-purchases/${purchaseId}/eway-bills/${id}/cancel`, { reason }),

  inboundThreshold: () =>
    apiClient.get<EwayInboundThresholdDto>('/api/eway-bills/threshold/inbound'),
}
