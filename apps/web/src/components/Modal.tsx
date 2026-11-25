import { type ReactNode, useEffect, useRef } from "react";

interface ModalProps {
  className: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A native modal dialog, open while mounted: the page behind it is inert and focus stays
 * inside. Esc and a click on the backdrop ask to close it; focus then goes back where it was.
 */
export function Modal({ className, label, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Whether the press began on the backdrop, so a drag out of a field does not close it. */
  const pressedBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes the dialog; the click is for the backdrop only.
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onCloseRef.current();
        pressedBackdrop.current = false;
      }}
    >
      {/* Fills the dialog, so only the backdrop is the dialog element itself. */}
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
