import { curriculumErrors, MODULES, flatChapters } from './curriculum';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const errors = curriculumErrors();
assert(errors.length === 0, errors.join('\n'));

const flat = flatChapters();
assert(flat.length === MODULES.reduce((n, m) => n + m.chapters.length, 0), 'flat chapter count');
assert(new Set(flat.map((h) => `${h.module.slug}/${h.chapter.slug}`)).size === flat.length, 'chapter ids unique');
assert(MODULES.length >= 8, 'eight modules');
assert(flat.length >= 40, 'a full path, not a stub');
