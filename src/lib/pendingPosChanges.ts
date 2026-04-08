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

export interface PendingActiveChange {
  id: string
  barcode: string
  itemCode: string
  description: string
  oldActive: boolean
  newActive: boolean
  timestamp: number
}

export interface PendingNewItem {
  id: string
  barcode: string
  itemCode: string
  description: string
  department: string
  sellPrice: number
  costPrice: number
  timestamp: number
}

export interface PendingPosState {
  priceChanges: PendingPriceChange[]
  promoChanges: PendingPromoChange[]
  activeChanges: PendingActiveChange[]
  newItems: PendingNewItem[]
}

// ── Module-level store ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'pending-pos-changes'
let listeners: Array<() => void> = []
let state: PendingPosState = loadFromStorage()

function emptyState(): PendingPosState {
  return { priceChanges: [], promoChanges: [], activeChanges: [], newItems: [] }
}

function loadFromStorage(): PendingPosState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // Backfill missing arrays from older sessions
      return {
        priceChanges:  parsed.priceChanges  ?? [],
        promoChanges:  parsed.promoChanges  ?? [],
        activeChanges: parsed.activeChanges ?? [],
        newItems:      parsed.newItems      ?? [],
      }
    }
  } catch { /* ignore */ }
  return emptyState()
}

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function emit() {
  persist()
  for (const fn of listeners) fn()
}

// ── Mutations: price ──────────────────────────────────────────────────────────

export function addPriceChange(change: Omit<PendingPriceChange, 'id' | 'timestamp'>) {
  // Dedup by barcode — replace existing entry
  const filtered = state.priceChanges.filter(c => c.barcode !== change.barcode)
  state = {
    ...state,
    priceChanges: [...filtered, { ...change, id: crypto.randomUUID(), timestamp: Date.now() }],
  }
  emit()
}

export function removePriceChange(id: string) {
  state = { ...state, priceChanges: state.priceChanges.filter(c => c.id !== id) }
  emit()
}

export function updatePriceChange(id: string, newPrice: number) {
  state = {
    ...state,
    priceChanges: state.priceChanges.map(c => c.id === id ? { ...c, newPrice } : c),
  }
  emit()
}

// ── Mutations: promo ──────────────────────────────────────────────────────────

export function addPromoChange(change: Omit<PendingPromoChange, 'id' | 'timestamp'>) {
  const filtered = state.promoChanges.filter(c => c.barcode !== change.barcode)
  state = {
    ...state,
    promoChanges: [...filtered, { ...change, id: crypto.randomUUID(), timestamp: Date.now() }],
  }
  emit()
}

export function removePromoChange(id: string) {
  state = { ...state, promoChanges: state.promoChanges.filter(c => c.id !== id) }
  emit()
}

export function updatePromoChange(id: string, promoPrice: number) {
  state = {
    ...state,
    promoChanges: state.promoChanges.map(c => c.id === id ? { ...c, promoPrice } : c),
  }
  emit()
}

// ── Mutations: active ─────────────────────────────────────────────────────────

export function addActiveChange(change: Omit<PendingActiveChange, 'id' | 'timestamp'>) {
  // Dedup by barcode — if the new state matches the original, drop the entry entirely
  // (e.g. user toggles off then on within the same session)
  const filtered = state.activeChanges.filter(c => c.barcode !== change.barcode)
  if (change.oldActive === change.newActive) {
    state = { ...state, activeChanges: filtered }
  } else {
    state = {
      ...state,
      activeChanges: [...filtered, { ...change, id: crypto.randomUUID(), timestamp: Date.now() }],
    }
  }
  emit()
}

export function removeActiveChange(id: string) {
  state = { ...state, activeChanges: state.activeChanges.filter(c => c.id !== id) }
  emit()
}

// ── Mutations: new items ──────────────────────────────────────────────────────

export function addNewItem(item: Omit<PendingNewItem, 'id' | 'timestamp'>) {
  const filtered = state.newItems.filter(c => c.barcode !== item.barcode)
  state = {
    ...state,
    newItems: [...filtered, { ...item, id: crypto.randomUUID(), timestamp: Date.now() }],
  }
  emit()
}

export function removeNewItem(id: string) {
  state = { ...state, newItems: state.newItems.filter(c => c.id !== id) }
  emit()
}

// ── Mutations: cross-cutting ──────────────────────────────────────────────────

export function removeByBarcode(barcode: string) {
  state = {
    priceChanges:  state.priceChanges.filter(c => c.barcode !== barcode),
    promoChanges:  state.promoChanges.filter(c => c.barcode !== barcode),
    activeChanges: state.activeChanges.filter(c => c.barcode !== barcode),
    newItems:      state.newItems.filter(c => c.barcode !== barcode),
  }
  emit()
}

export function clearAll() {
  state = emptyState()
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
  return s.priceChanges.length + s.promoChanges.length + s.activeChanges.length + s.newItems.length
}
