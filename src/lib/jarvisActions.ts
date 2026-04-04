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
  return jarvisPost('/api/pos-actions/adjust-stock', { barcode, adjustment, reason })
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
  barcode: string
  promoPrice: number
  startDate: string
  endDate: string
  description?: string
}

export async function createPromo(
  payload: CreatePromoPayload
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost('/api/pos-actions/create-promo', payload)
}

export async function printLabel(
  barcode: string
): Promise<{ success: boolean; message?: string }> {
  return jarvisPost('/api/pos-actions/print-label', { barcode })
}

// ── Stock Location Actions ───────────────────────────────────────────────────

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

export async function bulkAssignLocation(
  locationId: number,
  itemCodes: string[]
): Promise<{ success: boolean; assigned: number; message?: string }> {
  return jarvisPost(`/api/pos/locations/${locationId}/bulk-assign`, { itemCodes })
}

export async function createLocation(
  aisle: string,
  bay: string,
  description?: string
): Promise<{ success: boolean; id?: number; message?: string }> {
  return jarvisPost('/api/pos/locations', { aisle, bay, description })
}
