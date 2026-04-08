import { useSyncExternalStore } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PendingPriceChange {
  id: string
  barcode: string
  itemCode: string
  description: string
  oldPrice: number
  newPrice: number
  timestamp: number
}

export interface PendingPromoChange {
  id: string
  barcode: string
  itemCode: string
  description: string
  promoPrice: number
  normalPrice: number
  promoType: string
  startDate: string
  endDate: string
  timestamp: number
}

export interface PendingPosState {
  priceChanges: PendingPriceChange[]
  promoChanges: PendingPromoChange[]
}

// ── Module-level store ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'pending-pos-changes'
let listeners: Array<() => void> = []
let state: PendingPosState = loadFromStorage()

function loadFromStorage(): PendingPosState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { priceChanges: [], promoChanges: [] }
}

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function emit() {
  persist()
  for (const fn of listeners) fn()
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export function addPriceChange(change: Omit<PendingPriceChange, 'id' | 'timestamp'>) {
  // Dedup by barcode ��� replace existing entry
  const filtered = state.priceChanges.filter(c => c.barcode !== change.barcode)
  state = {
    ...state,
    priceChanges: [...filtered, { ...change, id: crypto.randomUUID(), timestamp: Date.now() }],
  }
  emit()
}

export function addPromoChange(change: Omit<PendingPromoChange, 'id' | 'timestamp'>) {
  const filtered = state.promoChanges.filter(c => c.barcode !== change.barcode)
  state = {
    ...state,
    promoChanges: [...filtered, { ...change, id: crypto.randomUUID(), timestamp: Date.now() }],
  }
  emit()
}

export function removePriceChange(id: string) {
  state = { ...state, priceChanges: state.priceChanges.filter(c => c.id !== id) }
  emit()
}

export function removePromoChange(id: string) {
  state = { ...state, promoChanges: state.promoChanges.filter(c => c.id !== id) }
  emit()
}

export function updatePriceChange(id: string, newPrice: number) {
  state = {
    ...state,
    priceChanges: state.priceChanges.map(c => c.id === id ? { ...c, newPrice } : c),
  }
  emit()
}

export function updatePromoChange(id: string, promoPrice: number) {
  state = {
    ...state,
    promoChanges: state.promoChanges.map(c => c.id === id ? { ...c, promoPrice } : c),
  }
  emit()
}

export function removeByBarcode(barcode: string) {
  state = {
    priceChanges: state.priceChanges.filter(c => c.barcode !== barcode),
    promoChanges: state.promoChanges.filter(c => c.barcode !== barcode),
  }
  emit()
}

export function clearAll() {
  state = { priceChanges: [], promoChanges: [] }
  emit()
}

// ── React hooks ────────────────────────────────────────────────────────────────

function subscribe(callback: () => void) {
  listeners = [...listeners, callback]
  return () => { listeners = listeners.filter(fn => fn !== callback) }
}

function getSnapshot(): PendingPosState {
  return state
}

export function usePendingPosChanges(): PendingPosState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function usePendingCount(): number {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return s.priceChanges.length + s.promoChanges.length
}
