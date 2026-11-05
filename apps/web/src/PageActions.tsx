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
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      notify(false);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, notify]);
}
export function PageActions({ children }: { children: ReactNode }) {
  const target = useContext(PageActionsContext);
  return target ? createPortal(children, target) : null;
}
