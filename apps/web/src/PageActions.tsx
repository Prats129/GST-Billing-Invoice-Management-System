import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const PageActionsContext = createContext<HTMLElement | null>(null);
export const UnsavedChangesContext = createContext<(dirty: boolean) => void>(
  () => {},
);
export function useUnsavedChanges(dirty: boolean) {
  const notify = useContext(UnsavedChangesContext);
  useEffect(() => {
    notify(dirty);
    return () => notify(false);
  }, [dirty, notify]);
}
export function PageActions({ children }: { children: ReactNode }) {
  const target = useContext(PageActionsContext);
  return target ? createPortal(children, target) : null;
}
