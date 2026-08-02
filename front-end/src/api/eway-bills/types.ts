/** Phase 5b — mirrors the BE EwayBillDto / RecordEwayBillRequest. Only
 *  inbound is populated today; the outbound-parent FK fields stay null
 *  until Phase 4 wires that side. */

export type EwayBillDirection = 'Inbound' | 'Outbound'
export type EwayBillStatus    = 'Draft' | 'Generated' | 'Cancelled' | 'Expired'
export type EwayGeneratedVia  = 'Manual' | 'API'
export type EwayTransportMode = 'Road' | 'Rail' | 'Air' | 'Ship'

export type EwayBillDto = {
  id: string
  ewayNumber: string
  generationDate: string | null
  direction: EwayBillDirection
  vendorPurchaseId: string | null
  stockRequestId:   string | null
  billId:           string | null
  documentNumber: string | null
  documentDate:   string | null
  fromGstin: string | null
  fromStateCode: string | null
  toGstin: string | null
  toStateCode: string | null
  transportMode:   EwayTransportMode | null
  distanceKm:      number | null
  transporterName: string | null
  vehicleNumber:   string | null
  taxableAmount: number | null
  cgstAmount:    number
  sgstAmount:    number
  igstAmount:    number
  totalAmount:   number | null
  validFrom:  string | null
  validUntil: string | null
  status:        EwayBillStatus
  generatedVia:  EwayGeneratedVia
  attachmentUrl: string | null
  notes:         string | null
  createdAt:     string
}

/** Only fields the client fills in manually — the SP supplies direction,
 *  status, generated_via, supply_type, sub_type, document_type. */
export type RecordEwayBillRequest = {
  ewayNumber: string
  generationDate?: string | null
  documentNumber?: string | null
  documentDate?:   string | null
  validUntil?:     string | null
  fromGstin?:      string | null
  fromStateCode?:  string | null
  toGstin?:        string | null
  toStateCode?:    string | null
  transportMode?:  EwayTransportMode | null
  distanceKm?:     number | null
  transporterName?: string | null
  vehicleNumber?:   string | null
  taxableAmount?:  number | null
  cgstAmount?:     number | null
  sgstAmount?:     number | null
  igstAmount?:     number | null
  totalAmount?:    number | null
  attachmentUrl?:  string | null
  notes?:          string | null
}

export type EwayInboundThresholdDto = {
  /** ₹ threshold at/above which an interstate vendor purchase requires an
   *  inbound e-way bill before Ordered → Received. 0 = gate disabled. */
  threshold: number
}
