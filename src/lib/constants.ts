import type { LiquorCategory } from './types'

export const LEAD_TIME_DEFAULT = 2

export const CATEGORY_LABELS: Record<LiquorCategory, string> = {
  beer:     'Beer & Craft',
  wine:     'Wine',
  spirits:  'Spirits & Whisky',
  cider:    'Cider',
  rtd:      'RTD & Premix',
  non_alc:  'Non-Alcoholic',
  other:    'Other',
}

export const CATEGORY_COLORS: Record<LiquorCategory, string> = {
  beer:    '#f59e0b',
  wine:    '#dc2626',
  spirits: '#7c3aed',
  cider:   '#10b981',
  rtd:     '#3b82f6',
  non_alc: '#6b7280',
  other:   '#9ca3af',
}

export const LIQUOR_DEPT_TERMS = [
  'liquor', 'beer', 'wine', 'spirits', 'beverages', 'alcohol', 'drinks', 'cider', 'rtd',
]

export const CATEGORY_ORDER: LiquorCategory[] = ['beer', 'wine', 'spirits', 'cider', 'rtd', 'non_alc', 'other']
