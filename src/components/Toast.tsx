import { memo } from 'react';
import { Toast } from '../types';

interface ToastProps {
  toast: Toast | null;
}

export const ToastNotification = memo(function ToastNotification({ toast }: ToastProps) {
  if (!toast) return null;

  return (
    <div className={`toast-notification toast-${toast.type || 'info'}`}>
      <span>{toast.message}</span>
    </div>
  );
});
