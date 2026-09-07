import * as React from 'react'
import { cn } from '../../lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-card border border-border bg-surface text-text shadow-md', className)}
      {...props}
    />
  )
}

export { Card }
