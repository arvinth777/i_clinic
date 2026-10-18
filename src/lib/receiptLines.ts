// True when at least one medicine was actually supplied -- otherwise there is no bill to print.
export const hasPrintableLines = (lines: { kind?: string; quantity?: number }[]) => lines.some(line => line.kind === 'medicine' && (line.quantity ?? 1) > 0)
