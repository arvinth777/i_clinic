import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './EmptyState.css'

// A pane with nothing selected: say what it is for, what to do next, and offer the most useful shortcut.
export function EmptyState({ icon, title, children, actions }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="empty-state">
    <span className="empty-state-icon"><Icon name={icon} size={22} /></span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
    {actions && <div className="empty-state-actions">{actions}</div>}
  </div>
}
