// Preserve offline rows when upgrading either earlier directory cache shape.
export function restorePagedCache<T extends { id: string }>(paged: { pages: T[][] } | undefined, legacy: T[] | undefined) {
  if (!paged && !Array.isArray(legacy)) return undefined
  const byId = new Map((paged?.pages.flat() ?? []).map(row => [row.id, row]))
  for (const row of legacy ?? []) if (!byId.has(row.id)) byId.set(row.id, row)
  const rows = [...byId.values()]
  const pageParams = Array.from({ length: Math.max(1, Math.ceil(rows.length / 50)) }, (_, i) => i * 50)
  return { pages: pageParams.map(start => rows.slice(start, start + 50)), pageParams }
}
