import { createContext, useContext } from 'react'

export type ConfirmOptions = { title: string; body?: string; confirmLabel: string; cancelLabel?: string }
export type Confirm = (options: ConfirmOptions) => Promise<boolean>

// Without a provider nothing is ever confirmed silently.
export const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false))
export const useConfirm = () => useContext(ConfirmContext)
