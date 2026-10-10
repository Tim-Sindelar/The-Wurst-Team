import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AdminSpaceActionsContext } from './AdminSpaceActionsContext';
/** Room subpages place their main action in the shared HTML-style header. */
export function AdminSpaceActions({ children }: { children: ReactNode }) {
  const target = useContext(AdminSpaceActionsContext);
  return target ? createPortal(children, target) : null;
}
