export type SortDirection = 'asc' | 'desc'

export type SortState<K extends string> = { key: K; direction: SortDirection } | null

export function nextSortState<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, direction: 'asc' }
  if (current.direction === 'asc') return { key, direction: 'desc' }
  return null
}

export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, getValue: (row: T, key: K) => string | number): T[] {
  if (!sort) return rows
  const { key, direction } = sort
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = getValue(a, key)
    const bv = getValue(b, key)
    if (av < bv) return -1 * sign
    if (av > bv) return 1 * sign
    return 0
  })
}
