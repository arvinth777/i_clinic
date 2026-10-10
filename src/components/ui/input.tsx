import * as React from 'react'
import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-none border-0 border-b border-border-strong bg-transparent px-0 text-base text-text transition-[color,box-shadow]',
        'placeholder:text-text-tertiary',
        'hover:border-border-strong',
        'focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none focus-visible:border-b-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
