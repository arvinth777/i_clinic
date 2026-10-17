import { createContext, useContext } from 'react'

export type ConfirmOptions = { title: string; body?: string; confirmLabel: string; cancelLabel?: string }
export type Confirm = (options: ConfirmOptions) => Promise<boolean>

// Without a provider nothing is ever confirmed silently.
export const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false))
export const useConfirm = () => useContext(ConfirmContext)

// Ask for a short reason before an action; resolves to the trimmed text, or null if the person backs out.
export type ReasonOptions = { title: string; body?: string; label: string; choices?: string[]; confirmLabel: string; cancelLabel?: string }
export type AskReason = (options: ReasonOptions) => Promise<string | null>
export const AskReasonContext = createContext<AskReason>(() => Promise.resolve(null))
export const useAskReason = () => useContext(AskReasonContext)
