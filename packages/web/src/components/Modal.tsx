import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  large?: boolean;
}

// Port of app/index.html's Modal — click-outside-to-close via the currentTarget check (a click
// that started inside .modal and ended up here via drag/select must not close it).
export function Modal({ title, onClose, children, footer, large }: ModalProps) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (large ? ' modal-lg' : '')}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="close-x" onClick={onClose}><i className="fas fa-xmark" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
