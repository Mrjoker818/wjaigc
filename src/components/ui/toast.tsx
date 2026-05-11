'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  onClose: (id: string) => void;
}

function Toast({ id, title, description, variant = 'default', onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-md rounded-lg border shadow-lg p-4 mb-2 animate-in slide-in-from-top-2 ${
        variant === 'destructive'
          ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
          : 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
      }`}
    >
      <div className="flex flex-col gap-1 flex-1">
        {title && (
          <div className="text-sm font-medium">{title}</div>
        )}
        {description && (
          <div className={`text-sm ${variant === 'destructive' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
            {description}
          </div>
        )}
      </div>
      <button
        onClick={() => onClose(id)}
        className="ml-4 text-zinc-400 hover:text-zinc-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (toast: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Expose toast function globally
  useEffect(() => {
    (window as unknown as { __toast: typeof addToast }).__toast = addToast;
  }, []);

  return (
    <ToastProviderContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 pointer-events-none">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            {...toast}
            onClose={removeToast}
          />
        ))}
      </div>
    </ToastProviderContext.Provider>
  );
}

import { createContext, useContext } from 'react';

const ToastProviderContext = createContext<{ toast: (props: Omit<ToastItem, 'id'>) => void }>({
  toast: () => {},
});

export const useToast = () => useContext(ToastProviderContext);
