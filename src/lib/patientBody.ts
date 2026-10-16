// "165 cm · 62 kg", leaving out whatever was not recorded.
export function formatBody(height: number | null | undefined, weight: number | null | undefined): string {
  return [height != null ? `${Number(height)} cm` : '', weight != null ? `${Number(weight)} kg` : ''].filter(Boolean).join(' · ')
}
