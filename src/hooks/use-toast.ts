'use client';

import { useState, useEffect } from 'react';

interface UseToastOptions {
  duration?: number;
}

interface ToastData {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

export function useToast(options: UseToastOptions = {}) {
  const [toasts, setToasts] = useState<Array<ToastData & { id: string }>>([]);

  const toast = (data: ToastData) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...data, id }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, options.duration || 5000);
  };

  return { toast, toasts };
}
