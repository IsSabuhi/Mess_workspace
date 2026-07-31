import { ArrowUpRight, BookMarked, FileText, FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";

import type { ArticleTreeNode } from "../lib/knowledgeTree";

type Props = {
  spaceId: string;
  nodes: ArticleTreeNode[];
  className?: string;
};

function countNodes(nodes: ArticleTreeNode[]): number {
  return nodes.reduce((n, x) => n + 1 + countNodes(x.children), 0);
}

function TocTreeList({
  nodes,
  spaceId,
  depth = 0,
}: {
  nodes: ArticleTreeNode[];
  spaceId: string;
  depth?: number;
}) {
  if (!nodes.length) return null;

  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-2 space-y-1.5 border-l border-sky-200/70 pl-3 dark:border-sky-900/50"}>
      {nodes.map((node) => {
        const hasKids = node.children.length > 0;
        return (
          <li key={node.id}>
            <Link
              to={`/knowledge/${spaceId}/${node.id}`}
              className={`group flex items-center justify-between gap-3 rounded-xl border transition hover:border-sky-300 hover:bg-sky-50/80 dark:hover:border-sky-700 dark:hover:bg-sky-950/30 ${
                depth === 0
                  ? "border-slate-200/80 bg-white/90 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60"
                  : "border-transparent bg-white/60 px-3 py-2 dark:bg-slate-900/40"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    hasKids
                      ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {hasKids ? <FolderOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate font-semibold text-slate-900 group-hover:text-sky-700 dark:text-slate-50 dark:group-hover:text-sky-300 ${
                      depth === 0 ? "text-base" : "text-sm"
                    }`}
                  >
                    {node.title}
                  </span>
                  {depth === 0 && (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-400">{node.slug}</span>
                  )}
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-sky-500 dark:text-slate-600" />
            </Link>
            {hasKids && <TocTreeList nodes={node.children} spaceId={spaceId} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Оглавление всего поддерева (папки и файлы) на странице родителя. */
export function KnowledgeChildrenToc({ spaceId, nodes, className = "" }: Props) {
  if (!nodes.length) return null;
  const total = countNodes(nodes);

  return (
    <nav
      className={`rounded-2xl border border-sky-200/80 bg-gradient-to-b from-sky-50/90 to-white p-5 shadow-soft dark:border-sky-900/50 dark:from-sky-950/40 dark:to-slate-900/50 ${className}`}
      aria-label="Содержание дочерних страниц"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <BookMarked className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
            Содержание
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {total}{" "}
            {total === 1 ? "страница в разделе" : total < 5 ? "страницы в разделе" : "страниц в разделе"}
          </p>
        </div>
      </div>
      <TocTreeList nodes={nodes} spaceId={spaceId} />
    </nav>
  );
}
