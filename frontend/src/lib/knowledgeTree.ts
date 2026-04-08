import type { KnowledgeArticleOut } from "../api/knowledge";

export type ArticleTreeNode = KnowledgeArticleOut & { children: ArticleTreeNode[] };

function sortArticles(a: KnowledgeArticleOut, b: KnowledgeArticleOut): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.title.localeCompare(b.title, "ru");
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
    children: (byParent.get(x.id) ?? []).sort(sortArticles).map(mapNode),
  });
  return (byParent.get(null) ?? []).sort(sortArticles).map(mapNode);
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
