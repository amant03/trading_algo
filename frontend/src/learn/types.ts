export type Level = 'Beginner' | 'Intermediate' | 'Advanced';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'example'; title: string; lines: string[] };

export interface QuizQ {
  prompt: string;
  choices: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  why: string;
}

export interface ChapterLink {
  to: string;
  label: string;
}

export interface Chapter {
  slug: string;
  title: string;
  minutes: number;
  blocks: Block[];
  quiz: QuizQ[];
  related?: ChapterLink[];
}

export interface Module {
  slug: string;
  title: string;
  blurb: string;
  level: Level;
  chapters: Chapter[];
}
