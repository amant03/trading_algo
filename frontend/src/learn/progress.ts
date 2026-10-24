import { create } from 'zustand';

const KEY = 'tradealgo.learn.progress.v1';

interface Saved {
  read: Record<string, true>;
  picks: Record<string, number>;
  last: string | null;
}

interface LearnState extends Saved {
  markRead: (id: string, read: boolean) => void;
  pick: (questionId: string, choice: number) => void;
  touch: (id: string) => void;
  reset: () => void;
}

const empty = (): Saved => ({ read: {}, picks: {}, last: null });

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Saved>;
    const read: Record<string, true> = {};
    if (parsed.read && typeof parsed.read === 'object') {
      for (const [k, v] of Object.entries(parsed.read)) {
        if (v === true && k.includes('/')) read[k] = true;
      }
    }
    const picks: Record<string, number> = {};
    if (parsed.picks && typeof parsed.picks === 'object') {
      for (const [k, v] of Object.entries(parsed.picks)) {
        if (typeof v === 'number' && v >= 0 && v <= 3) picks[k] = v;
      }
    }
    const last = typeof parsed.last === 'string' ? parsed.last : null;
    return { read, picks, last };
  } catch {
    return empty();
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode or a full disk — progress lasts until reload
  }
}

export const useLearn = create<LearnState>((set, get) => ({
  ...load(),
  markRead: (id, on) => {
    const read = { ...get().read };
    if (on) read[id] = true;
    else delete read[id];
    const next = { read, picks: get().picks, last: id };
    save(next);
    set(next);
  },
  pick: (questionId, choice) => {
    const picks = { ...get().picks, [questionId]: choice };
    const next = { read: get().read, picks, last: get().last };
    save(next);
    set(next);
  },
  touch: (id) => {
    if (get().last === id) return;
    const next = { read: get().read, picks: get().picks, last: id };
    save(next);
    set(next);
  },
  reset: () => {
    const next = empty();
    save(next);
    set(next);
  },
}));

export function questionId(chapterId: string, index: number): string {
  return `${chapterId}#${index}`;
}
