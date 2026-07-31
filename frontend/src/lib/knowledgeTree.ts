import type { KnowledgeArticleOut } from "../api/knowledge";

export type ArticleTreeNode = KnowledgeArticleOut & { children: ArticleTreeNode[] };

/**
 * Порядок среди соседей (один parent):
 * - если у всех одинаковый position (по умолчанию 0) — А…Я по названию;
 * - иначе ручной порядок по position, затем название.
 */
export function sortSiblingArticles(items: KnowledgeArticleOut[]): KnowledgeArticleOut[] {
  if (items.length <= 1) return [...items];
  const positions = new Set(items.map((a) => a.position));
  if (positions.size === 1) {
    return [...items].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.title.localeCompare(b.title, "ru");
  });
}

/** Новые позиции после сдвига статьи среди соседей (0…n-1). null — сдвиг невозможен. */
export function computeSiblingPositionsAfterMove(
  siblings: KnowledgeArticleOut[],
  articleId: string,
  direction: "up" | "down",
): { id: string; position: number }[] | null {
  const ordered = sortSiblingArticles(siblings);
  const idx = ordered.findIndex((a) => a.id === articleId);
  if (idx < 0) return null;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= ordered.length) return null;
  const next = [...ordered];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next.map((a, i) => ({ id: a.id, position: i }));
}

/**
 * position для новой статьи:
 * - режим А…Я (все соседи с одним position) — тот же position (обычно 0);
 * - ручной порядок — в конец (max + 1).
 */
export function nextArticlePosition(
  articles: KnowledgeArticleOut[],
  parentId: string | null,
): number {
  const siblings = articles.filter((a) => a.parent_id === parentId);
  if (!siblings.length) return 0;
  const positions = new Set(siblings.map((a) => a.position));
  if (positions.size === 1) return siblings[0].position;
  return Math.max(...siblings.map((a) => a.position)) + 1;
}

/** Дерево статей: корни — parent_id === null */
export function buildArticleTree(articles: KnowledgeArticleOut[]): ArticleTreeNode[] {
  const byParent = new Map<string | null, KnowledgeArticleOut[]>();
  for (const a of articles) {
    const p = a.parent_id;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(a);
  }
  const mapNode = (x: KnowledgeArticleOut): ArticleTreeNode => ({
    ...x,
    children: sortSiblingArticles(byParent.get(x.id) ?? []).map(mapNode),
  });
  return sortSiblingArticles(byParent.get(null) ?? []).map(mapNode);
}

/**
 * Статья для автооткрытия главной пространства:
 * первая корневая с дочерними (оглавление), иначе первая корневая.
 */
export function pickDefaultSpaceArticleId(roots: ArticleTreeNode[]): string | null {
  if (!roots.length) return null;
  const withChildren = roots.find((r) => r.children.length > 0);
  return (withChildren ?? roots[0]).id;
}

/** Цепочка от корня до leaf (включая leaf) */
export function articlePathToRoot(articles: KnowledgeArticleOut[], leafId: string): KnowledgeArticleOut[] {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const path: KnowledgeArticleOut[] = [];
  let id: string | null = leafId;
  const guard = new Set<string>();
  while (id && !guard.has(id)) {
    guard.add(id);
    const a = byId.get(id);
    if (!a) break;
    path.push(a);
    id = a.parent_id;
  }
  return path.reverse();
}

/** id статьи и всех потомков (для запрета выбора родителем самой себя / вниз по дереву) */
export function collectDescendantIds(articles: KnowledgeArticleOut[], rootId: string): Set<string> {
  const byParent = new Map<string | null, KnowledgeArticleOut[]>();
  for (const a of articles) {
    const p = a.parent_id;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(a);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    out.add(id);
    for (const c of byParent.get(id) ?? []) walk(c.id);
  };
  walk(rootId);
  return out;
}

/** Поддерево прямых детей статьи (с вложенностью). */
export function getArticleChildrenTree(
  articles: KnowledgeArticleOut[],
  parentId: string,
): ArticleTreeNode[] {
  const byParent = new Map<string | null, KnowledgeArticleOut[]>();
  for (const a of articles) {
    const p = a.parent_id;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(a);
  }
  const mapNode = (x: KnowledgeArticleOut): ArticleTreeNode => ({
    ...x,
    children: sortSiblingArticles(byParent.get(x.id) ?? []).map(mapNode),
  });
  return sortSiblingArticles(byParent.get(parentId) ?? []).map(mapNode);
}

export type FlatOption = { id: string; title: string; depth: number };

/** Плоский список для &lt;select&gt; с отступом по глубине */
export function flattenTreeForSelect(
  roots: ArticleTreeNode[],
  opts: { skipIds?: Set<string> },
): FlatOption[] {
  const skip = opts.skipIds ?? new Set();
  const out: FlatOption[] = [];
  const walk = (nodes: ArticleTreeNode[], depth: number) => {
    for (const n of nodes) {
      if (skip.has(n.id)) continue;
      out.push({ id: n.id, title: n.title, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
