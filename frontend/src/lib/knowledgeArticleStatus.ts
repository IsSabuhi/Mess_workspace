import type { ArticleStatus } from "../api/knowledge";

export const ARTICLE_STATUS_LABEL = {
  draft: "Черновик",
  published: "Опубликовано",
} as const;

/** Компактный бейдж статуса статьи (черновик / опубликовано). */
export function articleStatusBadgeClass(status: ArticleStatus): string {
  return status === "published"
    ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-950/45 dark:text-emerald-200 dark:ring-emerald-800/60"
    : "bg-amber-100 text-amber-900 ring-1 ring-amber-200/80 dark:bg-amber-950/45 dark:text-amber-200 dark:ring-amber-800/60";
}

/** Цвет заголовка в дереве / списках (без активного выделения). */
export function articleStatusTitleClass(status: ArticleStatus): string {
  return status === "published"
    ? "text-slate-800 dark:text-slate-100"
    : "text-amber-800 dark:text-amber-200";
}
