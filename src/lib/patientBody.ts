// "165 cm · 62 kg", leaving out whatever was not recorded.
export function formatBody(height: number | null | undefined, weight: number | null | undefined): string {
  return [height != null ? `${Number(height)} cm` : '', weight != null ? `${Number(weight)} kg` : ''].filter(Boolean).join(' · ')
}

// Optional; one decimal at most, within what the database accepts (patients_height_range / patients_weight_range).
export const bodyOk = (v: string, lo: number, hi: number) => !v.trim() || (/^\d{1,3}(\.\d)?$/.test(v.trim()) && Number(v) >= lo && Number(v) <= hi)
export const HEIGHT_RANGE = [30, 260] as const
export const WEIGHT_RANGE = [1, 400] as const
