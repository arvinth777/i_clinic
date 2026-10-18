import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva('ui-button', {
  variants: {
    variant: { primary: 'ui-button-primary', dark: 'ui-button-dark', secondary: 'ui-button-text', ghost: 'ui-button-neutral', success: 'ui-button-success', danger: 'ui-button-danger', warn: 'ui-button-warn' },
    size: { default: '', sm: 'ui-button-small' },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
})

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" aria-disabled={props.disabled || undefined} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
