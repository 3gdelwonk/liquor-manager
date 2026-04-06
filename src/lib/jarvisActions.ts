// ═══════════════════════════════════════════════
// JARVISmart POS Actions — Write Operations
// All POST/PUT/DELETE operations that modify POS state
// ═══════════════════════════════════════════════

import { jarvisPost, jarvisPut, jarvisDelete } from './jarvis'

// ── POS Actions ──────────────────────────────────────────────────────────────

export async function setCloudToken(token: string): Promise<{ success: boolean; message?: string }> {
  return jarvisPost('/api/pos-actions/set-token', { token })
}

export async function changePriceAndSend(
  barcode: string,
  newPrice: number
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost('/api/pos-actions/change-and-send', { barcode, newPrice })
}

export async function changePriceOnly(
  barcode: string,
  newPrice: number
): Promise<{ success: boolean; message?: string }> {
  return jarvisPut(`/api/pos-actions/price/${encodeURIComponent(barcode)}`, { newPrice })
}

export async function sendToPos(
  items: { barcode: string }[]
): Promise<{ success: boolean; sent: number; message?: string }> {
  return jarvisPost('/api/pos-actions/send-to-pos', { items })
}

export async function sendItemToPos(
  barcode: string
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost('/api/pos-actions/send-item-to-pos', { barcode })
}

export async function adjustStock(
  barcode: string,
  adjustment: number,
  reason?: string
): Promise<{ success: boolean; newQoh?: number; message?: string }> {
  return jarvisPost('/api/pos-actions/adjust-stock', { barcode, quantity: adjustment, reason })
}

export interface CreateItemPayload {
  barcode: string
  description: string
  department: string
  sellPrice: number
  costPrice: number
  reorderLevel?: number
  supplier?: string
  orderCode?: string
  cartonQty?: number
}

export async function createItem(
  payload: CreateItemPayload
): Promise<{ success: boolean; itemCode?: string; message?: string }> {
  return jarvisPost('/api/pos-actions/create-item', payload)
}

export interface CreatePromoPayload {
  barcodes: string[]
  promoSellPrice: number
  startDate: string
  endDate: string
  promoType?: string
  sendToPos?: boolean
  sendOffer?: boolean
}

export interface CreatePromoResult {
  ok: boolean
  success: boolean
  promotions?: { barcode: string; description: string; ok: boolean; promoSell: number }[]
  created?: number
  posSent?: boolean
  offerSent?: boolean
  batchId?: string
  message?: string
}

export async function createPromo(
  payload: CreatePromoPayload
): Promise<CreatePromoResult> {
  const res = await jarvisPost<CreatePromoResult>('/api/pos-actions/create-promo', payload)
  return { ...res, success: res.ok ?? res.success }
}

export interface PrintLabelResult {
  ok: boolean
  success: boolean
  barcode: string
  description?: string
  price?: number
  labelCount?: number
  batchId?: string
  message?: string
}

export async function printLabel(
  barcode: string,
  options?: { printerId?: number; count?: number; styleId?: number }
): Promise<PrintLabelResult> {
  const body: Record<string, unknown> = { barcode }
  if (options?.printerId) body.printerId = options.printerId
  if (options?.count && options.count > 1) body.count = options.count
  if (options?.styleId) body.styleId = options.styleId
  const res = await jarvisPost<PrintLabelResult>('/api/pos-actions/print-label', body)
  return { ...res, success: res.ok ?? res.success }
}

// ── Print Queue Operations ──────────────────────────────────────────────────

export async function generateLabelQueue(
  type: 'label' | 'talker',
  printerId: number
): Promise<{ success: boolean; message?: string }> {
  const res = await jarvisPost<{ ok?: boolean; success?: boolean; message?: string }>(
    '/api/pos/label-queue/generate', { type, printerId }
  )
  return { success: res.ok ?? res.success ?? false, message: res.message }
}

export async function removeFromQueue(
  barcodes: string[],
  type: 'label' | 'talker'
): Promise<{ success: boolean; message?: string }> {
  const res = await jarvisPost<{ ok?: boolean; success?: boolean; message?: string }>(
    '/api/pos/label-queue/remove', { barcodes, type }
  )
  return { success: res.ok ?? res.success ?? false, message: res.message }
}

export async function markQueuePrinted(
  barcodes: string[],
  type: 'label' | 'talker'
): Promise<{ success: boolean; message?: string }> {
  const res = await jarvisPost<{ ok?: boolean; success?: boolean; message?: string }>(
    '/api/pos/label-queue/mark-printed', { barcodes, type }
  )
  return { success: res.ok ?? res.success ?? false, message: res.message }
}

// ── Talker Printing ─────────────────────────────────────────────────────────

export async function printTalker(
  promoType: string,
  barcodes?: string[]
): Promise<{ success: boolean; queued?: number; message?: string }> {
  const body: Record<string, unknown> = { promoType }
  if (barcodes?.length) body.barcodes = barcodes
  const res = await jarvisPost<{ ok?: boolean; success?: boolean; queued?: number; message?: string }>(
    '/api/pos-actions/print-talker', body
  )
  return { success: res.ok ?? res.success ?? false, queued: res.queued, message: res.message }
}

// ── Price Lock ──────────────────────────────────────────────────────────────

export async function togglePriceLock(
  barcode: string,
  locked: boolean
): Promise<{ success: boolean; locked?: boolean; message?: string }> {
  return jarvisPut(`/api/pos/price-lock/${encodeURIComponent(barcode)}`, { locked })
}

// ── Stock Location Actions (Hierarchical) ───────────────────────────────────

export async function createLocation(
  name: string,
  shortCode: string,
  typeId: number,
  parentId?: number
): Promise<{ success: boolean; id?: number; message?: string }> {
  const body: Record<string, unknown> = { name, shortCode, typeId }
  if (parentId) body.parentId = parentId
  return jarvisPost('/api/pos/locations', body)
}

export async function updateLocation(
  locationId: number,
  updates: { name?: string; shortCode?: string; typeId?: number; parentId?: number }
): Promise<{ success: boolean; message?: string }> {
  return jarvisPut(`/api/pos/locations/${locationId}`, updates)
}

export async function deleteLocation(
  locationId: number
): Promise<{ success: boolean; message?: string }> {
  return jarvisDelete(`/api/pos/locations/${locationId}`)
}

export async function assignItemLocation(
  locationId: number,
  itemCode: string
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost(`/api/pos/locations/${locationId}/items`, { itemCode })
}

export async function removeItemLocation(
  locationId: number,
  itemCode: string
): Promise<{ success: boolean; message?: string }> {
  return jarvisDelete(`/api/pos/locations/${locationId}/items/${encodeURIComponent(itemCode)}`)
}

export async function moveItemLocation(
  locationId: number,
  itemCode: string,
  newLocationId: number
): Promise<{ success: boolean; message?: string }> {
  return jarvisPut(`/api/pos/locations/${locationId}/move`, { itemCode, newLocationId })
}

export async function bulkMoveLocation(
  locationId: number,
  itemCodes: string[]
): Promise<{ success: boolean; message?: string }> {
  return jarvisPut(`/api/pos/locations/${locationId}/bulk-move`, { itemCodes })
}

export async function bulkAssignLocation(
  locationId: number,
  itemCodes: string[]
): Promise<{ success: boolean; assigned?: number; message?: string }> {
  return jarvisPost(`/api/pos/locations/${locationId}/bulk-assign`, { itemCodes })
}

export async function assignDepartmentToLocation(
  locationId: number,
  department: string
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost(`/api/pos/locations/${locationId}/assign-department`, { department })
}
