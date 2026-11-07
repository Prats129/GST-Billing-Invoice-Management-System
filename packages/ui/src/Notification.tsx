import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './notifications.css';

let host: HTMLDivElement | undefined;
let observer: MutationObserver | undefined;
function notificationHost() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'gst-notification-stack';
    host.setAttribute('aria-label', 'Notifications');
    host.setAttribute('role', 'region');
    document.body.append(host);
  }
  const place = () => {
    const dialogs =
      document.querySelectorAll<HTMLDialogElement>('dialog[open]');
    const parent = dialogs.item(dialogs.length - 1) ?? document.body;
    if (host && host.parentElement !== parent) {
      parent.append(host);
      if (parent instanceof HTMLDialogElement)
        document.dispatchEvent(new Event('gst-notification-context-change'));
    }
  };
  if (!observer) {
    // Ignore ordinary form/text changes; only dialog transitions move the host.
    observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          record.type === 'attributes'
            ? record.target instanceof HTMLDialogElement
            : [...record.addedNodes, ...record.removedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (node.matches('dialog') || node.querySelector('dialog')),
              ),
        )
      )
        place();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
  }
  place();
  return host;
}

export function Notification({
  message,
  kind = 'error',
  children,
  onDismiss,
}: {
  message: string;
  kind?: 'error' | 'success' | 'warning';
  children?: ReactNode;
  onDismiss?: (() => void) | undefined;
}) {
  const [target, setTarget] = useState<HTMLDivElement>();
  const card = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setTarget(notificationHost());
  }, []);
  useEffect(() => {
    setDismissed(false);
  }, [message]);
  useEffect(() => {
    if (kind === 'error') return;
    const clear = () => {
      setDismissed(true);
      onDismiss?.();
    };
    document.addEventListener('gst-notification-context-change', clear);
    window.addEventListener('hashchange', clear);
    return () => {
      document.removeEventListener('gst-notification-context-change', clear);
      window.removeEventListener('hashchange', clear);
    };
  }, [kind, onDismiss]);
  useEffect(() => {
    if (target && card.current) target.scrollTop = card.current.offsetTop;
  }, [target, message]);
  if (!target || !message || dismissed) return null;
  return createPortal(
    <section
      ref={card}
      className="gst-notification"
      data-kind={kind}
      role={kind === 'success' ? 'status' : 'alert'}
      aria-atomic="true"
    >
      <div className="gst-notification-heading">
        <strong>
          {kind === 'error'
            ? 'Unable to complete action'
            : kind === 'success'
              ? 'Success'
              : 'Please note'}
        </strong>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          ×
        </button>
      </div>
      <div className="gst-notification-content">{children ?? message}</div>
    </section>,
    target,
  );
}
