import type { Chapter, Module } from './types';
import { market } from './modules/market';
import { charts } from './modules/charts';
import { business } from './modules/business';
import { futures } from './modules/futures';
import { options } from './modules/options';
import { risk } from './modules/risk';
import { systems } from './modules/systems';
import { money } from './modules/money';

export const MODULES: Module[] = [market, charts, business, futures, options, risk, systems, money];

export function chapterKey(moduleSlug: string, chapterSlug: string): string {
  return `${moduleSlug}/${chapterSlug}`;
}

export function moduleMinutes(mod: Module): number {
  return mod.chapters.reduce((sum, ch) => sum + ch.minutes, 0);
}

export function findModule(slug: string | undefined): Module | undefined {
  if (!slug) return undefined;
  return MODULES.find((m) => m.slug === slug);
}

export interface ChapterHit {
  module: Module;
  chapter: Chapter;
  index: number;
  moduleIndex: number;
}

export function findChapter(moduleSlug: string | undefined, chapterSlug: string | undefined): ChapterHit | undefined {
  const moduleIndex = MODULES.findIndex((m) => m.slug === moduleSlug);
  if (moduleIndex < 0) return undefined;
  const mod = MODULES[moduleIndex];
  const index = mod.chapters.findIndex((c) => c.slug === chapterSlug);
  if (index < 0) return undefined;
  return { module: mod, chapter: mod.chapters[index], index, moduleIndex };
}

export function flatChapters(): ChapterHit[] {
  const out: ChapterHit[] = [];
  MODULES.forEach((mod, moduleIndex) => {
    mod.chapters.forEach((chapter, index) => {
      out.push({ module: mod, chapter, index, moduleIndex });
    });
  });
  return out;
}

export function curriculumErrors(modules: Module[] = MODULES): string[] {
  const errors: string[] = [];
  const slugs = new Set<string>();
  for (const mod of modules) {
    if (!/^[a-z0-9-]+$/.test(mod.slug)) errors.push(`bad module slug ${mod.slug}`);
    if (slugs.has(mod.slug)) errors.push(`duplicate module ${mod.slug}`);
    slugs.add(mod.slug);
    if (mod.chapters.length < 4) errors.push(`${mod.slug} needs at least 4 chapters`);
    const seen = new Set<string>();
    for (const ch of mod.chapters) {
      const id = chapterKey(mod.slug, ch.slug);
      if (!/^[a-z0-9-]+$/.test(ch.slug)) errors.push(`bad chapter slug ${id}`);
      if (seen.has(ch.slug)) errors.push(`duplicate chapter ${id}`);
      seen.add(ch.slug);
      if (ch.blocks.length < 3) errors.push(`${id} is too thin`);
      if (ch.minutes < 3 || ch.minutes > 20) errors.push(`${id} minutes ${ch.minutes}`);
      if (ch.quiz.length < 2) errors.push(`${id} needs two checks`);
      ch.quiz.forEach((q, i) => {
        if (q.choices.length !== 4) errors.push(`${id}#${i} choices`);
        if (q.answer < 0 || q.answer > 3) errors.push(`${id}#${i} answer`);
        const unique = new Set(q.choices);
        if (unique.size !== 4) errors.push(`${id}#${i} duplicate choice`);
        if (!q.why.trim() || !q.prompt.trim()) errors.push(`${id}#${i} empty prompt`);
      });
    }
  }
  return errors;
}
