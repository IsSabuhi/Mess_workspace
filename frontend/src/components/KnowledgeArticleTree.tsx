import { ChevronDown, ChevronRight, ChevronUp, FileText, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { ArticleTreeNode } from "../lib/knowledgeTree";

type Props = {
  nodes: ArticleTreeNode[];
  spaceId: string;
  canEdit: boolean;
  onDeletePage?: (id: string, title: string) => void;
  onMoveArticle?: (id: string, direction: "up" | "down") => void;
  deletingArticleId?: string | null;
  movingArticleId?: string | null;
  activeArticleId?: string | null;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
  depth?: number;
};

export function KnowledgeArticleTree({
  nodes,
  spaceId,
  canEdit,
  onDeletePage,
  onMoveArticle,
  deletingArticleId,
  movingArticleId,
  activeArticleId,
  collapsedIds,
  onToggleCollapse,
  depth = 0,
}: Props) {
  if (!nodes.length) return null;

  return (
    <ul className={`min-w-0 ${depth === 0 ? "space-y-0.5" : "mt-0.5 space-y-0.5"}`} role="tree">
      {nodes.map((n, index) => {
        const hasKids = n.children.length > 0;
        const collapsed = collapsedIds?.has(n.id) ?? false;
        const active = activeArticleId === n.id;
        const deleting = deletingArticleId === n.id;
        const moving = movingArticleId === n.id;
        const canMoveUp = !!onMoveArticle && index > 0;
        const canMoveDown = !!onMoveArticle && index < nodes.length - 1;
        const showMove = canEdit && !!onMoveArticle && nodes.length > 1;

        return (
          <li key={n.id} className="min-w-0" role="treeitem" aria-expanded={hasKids ? !collapsed : undefined}>
            <div
              className={`group relative flex min-w-0 items-center gap-1 rounded-xl px-1.5 py-1.5 transition ${
                active
                  ? "bg-sky-50 text-sky-900 shadow-sm ring-1 ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-800/60"
                  : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
              }`}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sky-500"
                  aria-hidden
                />
              )}

              {hasKids ? (
                <button
                  type="button"
                  onClick={() => onToggleCollapse?.(n.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/80 hover:text-slate-700 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                  title={collapsed ? "Развернуть" : "Свернуть"}
                >
                  {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-300 dark:text-slate-600">
                  <FileText className="h-3.5 w-3.5" />
                </span>
              )}

              {hasKids && (
                <FolderOpen
                  className={`h-3.5 w-3.5 shrink-0 ${
                    active ? "text-sky-500" : "text-amber-500/90 dark:text-amber-400/80"
                  }`}
                  aria-hidden
                />
              )}

              <Link
                to={`/knowledge/${spaceId}/${n.id}`}
                title={n.title}
                className={`min-w-0 flex-1 truncate text-sm ${
                  active
                    ? "font-semibold text-sky-800 dark:text-sky-100"
                    : "font-medium text-slate-800 hover:text-sky-600 dark:text-slate-100 dark:hover:text-sky-400"
                }`}
              >
                {n.title}
              </Link>

              {canEdit && (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  {showMove && (
                    <>
                      <button
                        type="button"
                        disabled={!canMoveUp || !!movingArticleId}
                        title="Выше"
                        onClick={() => onMoveArticle?.(n.id, "up")}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/80 disabled:opacity-30 dark:hover:bg-slate-700"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown || !!movingArticleId}
                        title="Ниже"
                        onClick={() => onMoveArticle?.(n.id, "down")}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/80 disabled:opacity-30 dark:hover:bg-slate-700"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <Link
                    to={`/knowledge/${spaceId}/new?parent=${n.id}`}
                    title="Дочерняя страница"
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-sky-600 hover:bg-sky-100 dark:text-sky-400 dark:hover:bg-sky-950/50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Link>
                  {onDeletePage && (
                    <button
                      type="button"
                      disabled={deleting || moving}
                      title="Удалить страницу"
                      onClick={() => onDeletePage(n.id, n.title)}
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {hasKids && !collapsed && (
              <div className="ml-3 border-l border-slate-200/90 pl-2 dark:border-slate-700/80">
                <KnowledgeArticleTree
                  nodes={n.children}
                  spaceId={spaceId}
                  canEdit={canEdit}
                  onDeletePage={onDeletePage}
                  onMoveArticle={onMoveArticle}
                  deletingArticleId={deletingArticleId}
                  movingArticleId={movingArticleId}
                  activeArticleId={activeArticleId}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={onToggleCollapse}
                  depth={depth + 1}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
