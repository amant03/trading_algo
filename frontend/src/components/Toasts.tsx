import { useCallback } from 'react';
import { create } from 'zustand';
import { cls } from '../format';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, kind?: Toast['kind']) => void;
  remove: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().remove(id), 4200);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function useToast() {
  return useCallback((text: string, kind?: Toast['kind']) => useToasts.getState().push(text, kind), []);
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const remove = useToasts((s) => s.remove);
  return (
    <div className="toast-zone">
      {toasts.map((t) => (
        <div key={t.id} className={cls('toast', t.kind === 'ok' && 'ok', t.kind === 'err' && 'err')} onClick={() => remove(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
