import { useLayoutEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

export function usePrintDocument(documentKey: string) {
  const activeDocument = useRef<string | null>(null)
  useLayoutEffect(() => {
    activeDocument.current = documentKey
    return () => { activeDocument.current = null }
  }, [documentKey])
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: async (requestedDocument: string) => {
      if (activeDocument.current !== requestedDocument) return
      // Hidden print sections do not load their fonts until print layout starts.
      try {
        await Promise.all(Array.from(document.fonts).map(font => font.load()))
        await document.fonts.ready
      } catch {
        throw new Error('Print fonts are unavailable. Reconnect to load them, then try printing again.')
      }
      if (activeDocument.current === requestedDocument) window.print()
    },
  })
  return { ...mutation, mutate: () => mutation.mutate(documentKey) }
}
