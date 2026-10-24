import type { Block } from './types';

export const p = (text: string): Block => ({ kind: 'p', text });
export const h = (text: string): Block => ({ kind: 'h', text });
export const ul = (...items: string[]): Block => ({ kind: 'ul', items });
export const note = (text: string): Block => ({ kind: 'note', text });
export const example = (title: string, ...lines: string[]): Block => ({ kind: 'example', title, lines });
