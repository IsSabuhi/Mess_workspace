import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import {
  addSpaceMember,
  createArticle,
  createKnowledgeSpace,
  createKnowledgeTemplate,
  deleteArticle,
  getArticle,
  getKnowledgeSpace,
  listArticleRevisions,
  listArticles,
  listKnowledgeSpaces,
  listKnowledgeTemplates,
  listSpaceMembers,
  removeSpaceMember,
  restoreArticleRevision,
  searchArticles,
  searchSpaceUsers,
  updateArticle,
  updateSpaceMember,
  uploadKnowledgeImage,
} from "../api/knowledge";
import type {
  KnowledgeArticleCreate,
  KnowledgeArticleOut,
  KnowledgeArticleUpdate,
  KnowledgeTemplateOut,
  SpaceMemberRole,
} from "../api/knowledge";
import { listSystems } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { KnowledgeArticleReader, extractTocFromArticleHtml } from "../components/KnowledgeArticleReader";
import { KnowledgeRichEditor } from "../components/KnowledgeRichEditor";
import { useAuth } from "../context/AuthContext";
import { PERM, hasPermission } from "../lib/permissions";
import {
  articlePathToRoot,
  buildArticleTree,
  collectDescendantIds,
  flattenTreeForSelect,
  type ArticleTreeNode,
  type FlatOption,
} from "../lib/knowledgeTree";
import { invalidateAndRefetch } from "../lib/queryClient";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";

function slugify(s: string): string {
  const t = s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return t || "article";
}

function queryErr(e: unknown): string | null {
  if (e instanceof ApiError) return e.detail;
  if (e) return "Ошибка загрузки";
  return null;
}

const SPACE_ROLE_LABELS: Record<SpaceMemberRole, string> = {
  viewer: "Только просмотр",
  editor: "Редактор",
  admin: "Администратор",
};

function ParentPageSelect({
  value,
  onChange,
  disabled,
  options,
  pending,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  options: FlatOption[];
  pending: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Родительская страница</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || pending}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
      >
        <option value="">— Корень (верхний уровень) —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {`${"— ".repeat(o.depth)}${o.title}`}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">
        Дочерние страницы показываются деревом в списке пространства. Корень — без родителя.
      </p>
    </div>
  );
}

function ArticleTreeList({
  nodes,
  spaceId,
  canEdit,
  onDeletePage,
  deletingArticleId,
  activeArticleId,
  collapsedIds,
  onToggleCollapse,
}: {
  nodes: ArticleTreeNode[];
  spaceId: string;
  canEdit: boolean;
  onDeletePage?: (id: string, title: string) => void;
  deletingArticleId?: string | null;
  activeArticleId?: string | null;
  collapsedIds?: Set<string>;
  onToggleCollapse?: (id: string) => void;
}) {
  if (!nodes.length) return null;
  return (
    <ul className="space-y-1">
      {nodes.map((n) => (
        <li key={n.id}>
          <div
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-1 py-0.5 ${
              activeArticleId === n.id
                ? "border-slate-300 bg-slate-100/80 dark:border-slate-600 dark:bg-slate-800/80"
                : "border-transparent hover:border-slate-200 dark:hover:border-slate-600"
            }`}
          >
            {n.children.length > 0 ? (
              <button
                type="button"
                onClick={() => onToggleCollapse?.(n.id)}
                className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                title={collapsedIds?.has(n.id) ? "Развернуть" : "Свернуть"}
              >
                {collapsedIds?.has(n.id) ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-3" />
            )}
            <Link
              to={`/knowledge/${spaceId}/${n.id}`}
              className="font-medium text-slate-900 hover:text-sky-600 dark:text-white dark:hover:text-sky-400"
            >
              {n.title}
            </Link>
            {canEdit && (
              <Link
                to={`/knowledge/${spaceId}/new?parent=${n.id}`}
                className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                + Дочерняя
              </Link>
            )}
            {canEdit && onDeletePage && (
              <button
                type="button"
                disabled={deletingArticleId === n.id}
                title="Удалить страницу"
                onClick={() => onDeletePage(n.id, n.title)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                {deletingArticleId === n.id ? "Удаление…" : "Удалить"}
              </button>
            )}
          </div>
          {n.children.length > 0 && !collapsedIds?.has(n.id) && (
            <div className="ml-3 mt-1 border-l-2 border-slate-200 pl-3 dark:border-slate-600">
              <ArticleTreeList
                nodes={n.children}
                spaceId={spaceId}
                canEdit={canEdit}
                onDeletePage={onDeletePage}
                deletingArticleId={deletingArticleId}
                activeArticleId={activeArticleId}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function KnowledgePage() {
  const { spaceId, articleId } = useParams<{ spaceId?: string; articleId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canManageSpaces = !!(user && hasPermission(user, PERM.KNOWLEDGE_MANAGE_ALL));

  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceSlug, setNewSpaceSlug] = useState("");
  const [newSpaceDescription, setNewSpaceDescription] = useState("");
  const [newSpaceSystemId, setNewSpaceSystemId] = useState("");

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [html, setHtml] = useState("<p></p>");
  const [localError, setLocalError] = useState<string | null>(null);
  const [memberSearchQ, setMemberSearchQ] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<SpaceMemberRole>("viewer");
  const [parentId, setParentId] = useState<string>("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateSlug, setNewTemplateSlug] = useState("");
  const [tocHeadings, setTocHeadings] = useState<{ id: string; text: string; level: number }[]>([]);
  const [spaceSearchQ, setSpaceSearchQ] = useState("");
  const [sidebarArticleSearchQ, setSidebarArticleSearchQ] = useState("");
  const [collapsedArticleIds, setCollapsedArticleIds] = useState<Set<string>>(new Set());
  /** Для существующей статьи — сразу режим чтения; для «new» — редактирование. */
  const [readingMode, setReadingMode] = useState(() => articleId != null && articleId !== "new");
  const [revisionsModalOpen, setRevisionsModalOpen] = useState(false);

  const isNew = articleId === "new";

  const spacesQuery = useQuery({
    queryKey: ["knowledge", "spaces"],
    queryFn: listKnowledgeSpaces,
    enabled: !spaceId,
    staleTime: 60_000,
  });

  const systemsForSpaceQuery = useQuery({
    queryKey: ["systems", "knowledge-create"],
    queryFn: () => listSystems(true),
    enabled: !spaceId && canManageSpaces && createSpaceOpen,
  });

  const createSpaceMut = useMutation({
    mutationFn: createKnowledgeSpace,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
      setCreateSpaceOpen(false);
      setNewSpaceName("");
      setNewSpaceSlug("");
      setNewSpaceDescription("");
      setNewSpaceSystemId("");
      toastSuccess("Пространство создано");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось создать пространство"),
  });

  const spaceQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId],
    queryFn: () => getKnowledgeSpace(spaceId!),
    enabled: !!spaceId,
    staleTime: 60_000,
  });

  const articlesQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId, "articles"],
    queryFn: () => listArticles(spaceId!),
    enabled: !!spaceId,
    staleTime: 60_000,
  });

  const articleQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId, "article", articleId],
    queryFn: () => getArticle(spaceId!, articleId!),
    enabled: !!spaceId && !!articleId && articleId !== "new",
    staleTime: 60_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["knowledge", "templates", spaceId ?? ""],
    queryFn: () => listKnowledgeTemplates(spaceId),
    enabled: !!spaceId,
    staleTime: 60_000,
  });
  const searchQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId ?? "", "search", searchQ],
    queryFn: () => searchArticles(spaceId!, searchQ),
    enabled: !!spaceId && searchQ.trim().length >= 2,
  });
  const revisionsQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId ?? "", "article", articleId ?? "", "revisions"],
    queryFn: () => listArticleRevisions(spaceId!, articleId!),
    enabled: !!spaceId && !!articleId && articleId !== "new",
  });

  /** Стабильный ключ монтирования редактора: без смены при каждом символе, с remount после загрузки статьи с API */
  const knowledgeEditorKey = useMemo(() => {
    if (articleId === "new") return `${spaceId ?? ""}-new`;
    if (
      spaceId &&
      articleId &&
      articleQuery.isSuccess &&
      articleQuery.data?.id === articleId
    ) {
      return `${spaceId}-${articleId}-ready`;
    }
    return `${spaceId ?? ""}-${articleId ?? ""}-wait`;
  }, [spaceId, articleId, articleQuery.isSuccess, articleQuery.data?.id]);

  const membersQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId, "members"],
    queryFn: () => listSpaceMembers(spaceId!),
    enabled: !!spaceId && !articleId && !!spaceQuery.data?.can_manage_members,
  });

  const directoryQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId, "directory", memberSearchQ],
    queryFn: () => searchSpaceUsers(spaceId!, memberSearchQ),
    enabled: !!spaceId && !articleId && !!spaceQuery.data?.can_manage_members,
  });

  const space = spaceQuery.data ?? null;

  useEffect(() => {
    if (articleId !== "new" && articleId) return;
    setTitle("");
    setSlug("");
    setStatus("draft");
    setHtml("<p></p>");
    setParentId(searchParams.get("parent") ?? "");
  }, [articleId, spaceId, searchParams]);

  useEffect(() => {
    if (!articleId || articleId === "new") return;
    const art = articleQuery.data;
    if (art && art.id === articleId) return;
    setTitle("");
    setSlug("");
    setStatus("draft");
    setHtml("<p></p>");
  }, [articleId, articleQuery.data]);

  useEffect(() => {
    if (!articleId || articleId === "new") return;
    const art = articleQuery.data;
    if (!art || art.id !== articleId) return;
    setTitle(art.title);
    setSlug(art.slug);
    setStatus(art.status);
    setHtml(art.content || "<p></p>");
    setParentId(art.parent_id ?? "");
  }, [articleId, articleQuery.data]);

  useEffect(() => {
    if (!articleId || articleId === "new") {
      setReadingMode(false);
      return;
    }
    setReadingMode(true);
  }, [articleId]);

  const createMut = useMutation({
    mutationFn: ({ sid, body }: { sid: string; body: KnowledgeArticleCreate }) => createArticle(sid, body),
    onSuccess: async (created, vars) => {
      const key = ["knowledge", "space", vars.sid, "articles"] as const;
      qc.setQueryData<KnowledgeArticleOut[]>(key, (prev) => {
        if (!prev) return [created];
        if (prev.some((a) => a.id === created.id)) return prev;
        return [...prev, created];
      });
      await invalidateAndRefetch(qc, key);
    },
  });
  const createTemplateMut = useMutation({
    mutationFn: createKnowledgeTemplate,
    onSuccess: () => {
      setTemplateModalOpen(false);
      setNewTemplateName("");
      setNewTemplateSlug("");
      void qc.invalidateQueries({ queryKey: ["knowledge", "templates", spaceId ?? ""] });
      toastSuccess("Шаблон сохранён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить шаблон"),
  });

  const updateMut = useMutation({
    mutationFn: ({
      sid,
      aid,
      body,
    }: {
      sid: string;
      aid: string;
      body: KnowledgeArticleUpdate;
    }) => updateArticle(sid, aid, body),
    onSuccess: async (updated, v) => {
      qc.setQueryData<KnowledgeArticleOut[]>(
        ["knowledge", "space", v.sid, "articles"],
        (prev) =>
          prev ? prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)) : prev,
      );
      qc.setQueryData<KnowledgeArticleOut>(
        ["knowledge", "space", v.sid, "article", v.aid],
        (prev) => (prev && prev.id === updated.id ? updated : prev),
      );
      await invalidateAndRefetch(qc, ["knowledge", "space", v.sid, "articles"]);
      await invalidateAndRefetch(qc, ["knowledge", "space", v.sid, "article", v.aid]);
    },
  });
  const restoreRevisionMut = useMutation({
    mutationFn: ({ sid, aid, rid }: { sid: string; aid: string; rid: string }) =>
      restoreArticleRevision(sid, aid, rid),
    onSuccess: async (restored, vars) => {
      setTitle(restored.title);
      setHtml(restored.content ?? "<p></p>");
      setStatus(restored.status);
      setParentId(restored.parent_id ?? "");
      await invalidateAndRefetch(qc, ["knowledge", "space", vars.sid, "article", vars.aid]);
      await invalidateAndRefetch(qc, ["knowledge", "space", vars.sid, "article", vars.aid, "revisions"]);
      await invalidateAndRefetch(qc, ["knowledge", "space", vars.sid, "articles"]);
      toastSuccess("Версия восстановлена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось восстановить версию"),
  });

  const deleteArticleMut = useMutation({
    mutationFn: (aid: string) => deleteArticle(spaceId!, aid),
    onSuccess: async (_, aid) => {
      setDeleteConfirm(null);
      const articlesKey = ["knowledge", "space", spaceId!, "articles"] as const;
      qc.setQueryData<KnowledgeArticleOut[]>(articlesKey, (prev) => {
        if (!prev) return prev;
        return prev
          .filter((a) => a.id !== aid)
          .map((a) => (a.parent_id === aid ? { ...a, parent_id: null } : a));
      });
      void qc.removeQueries({ queryKey: ["knowledge", "space", spaceId, "article", aid] });
      await invalidateAndRefetch(qc, articlesKey);
      toastSuccess("Страница удалена");
      if (articleId && articleId !== "new" && articleId === aid) {
        navigate(`/knowledge/${spaceId}`);
      }
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить страницу"),
  });

  const confirmDeletePage = useCallback((aid: string, title: string) => {
    if (!spaceId) return;
    setDeleteConfirm({ id: aid, title });
  }, [spaceId]);

  const deletePageDialog = (
    <ConfirmDialog
      open={!!deleteConfirm}
      onClose={() => !deleteArticleMut.isPending && setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm) deleteArticleMut.mutate(deleteConfirm.id);
      }}
      title="Удалить страницу?"
      message={
        deleteConfirm ? (
          <>
            Вы собираетесь удалить страницу «
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{deleteConfirm.title}</strong>».{" "}
            Вложенные страницы останутся в пространстве и станут корневыми — у них больше не будет этой родительской
            страницы.
          </>
        ) : (
          ""
        )
      }
      variant="danger"
      confirmLabel="Удалить"
      cancelLabel="Отмена"
      pending={deleteArticleMut.isPending}
    />
  );

  const addMemberMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: SpaceMemberRole }) =>
      addSpaceMember(spaceId!, { user_id: userId, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["knowledge", "space", spaceId, "members"] });
      void qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
      toastSuccess("Участник добавлен");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось добавить"),
  });

  const updateMemberRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: SpaceMemberRole }) =>
      updateSpaceMember(spaceId!, userId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["knowledge", "space", spaceId, "members"] });
      toastSuccess("Роль обновлена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось обновить роль"),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => removeSpaceMember(spaceId!, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["knowledge", "space", spaceId, "members"] });
      void qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
      toastSuccess("Участник удалён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить"),
  });

  const loadingRoot = !spaceId && spacesQuery.isPending;
  const loadingList =
    !!spaceId && !articleId && (spaceQuery.isPending || articlesQuery.isPending);
  const loadingNew = !!spaceId && articleId === "new" && spaceQuery.isPending;
  const loadingArticle =
    !!spaceId &&
    !!articleId &&
    articleId !== "new" &&
    (spaceQuery.isPending || articleQuery.isPending);

  const errorRoot = !spaceId ? queryErr(spacesQuery.error) : null;
  const errorList =
    spaceId && !articleId
      ? queryErr(spaceQuery.error) ?? queryErr(articlesQuery.error)
      : null;
  const errorNew = spaceId && articleId === "new" ? queryErr(spaceQuery.error) : null;
  const errorArticle =
    spaceId && articleId && articleId !== "new"
      ? queryErr(spaceQuery.error) ?? queryErr(articleQuery.error)
      : null;

  const article = articleQuery.data ?? null;
  const canEdit = space?.can_edit ?? false;

  const showArticleReader = !!articleId && articleId !== "new" && (!canEdit || readingMode);

  const articleTocItems = useMemo(() => {
    if (!articleId || articleId === "new") return [];
    if (!canEdit || readingMode) return extractTocFromArticleHtml(html);
    return tocHeadings;
  }, [articleId, canEdit, readingMode, html, tocHeadings]);

  const tocLinksEnabled = !canEdit || readingMode;

  const handleSave = async () => {
    if (!spaceId || !canEdit) return;
    const t = title.trim();
    if (!t) {
      setLocalError("Укажите заголовок");
      return;
    }
    const sl = (slug.trim() || slugify(t)).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(sl)) {
      setLocalError("Slug: только латиница, цифры и дефис");
      return;
    }
    setLocalError(null);
    try {
      if (isNew) {
        const created = await createMut.mutateAsync({
          sid: spaceId,
          body: {
            title: t,
            slug: sl,
            content: html,
            status,
            parent_id: parentId || null,
          },
        });
        navigate(`/knowledge/${spaceId}/${created.id}`, { replace: true });
        toastSuccess("Статья создана");
      } else if (articleId && articleId !== "new") {
        await updateMut.mutateAsync({
          sid: spaceId,
          aid: articleId,
          body: {
            title: t,
            content: html,
            status,
            parent_id: parentId || null,
          },
        });
        toastSuccess("Статья сохранена");
      }
    } catch (e) {
      if (e instanceof ApiError) setLocalError(e.detail);
      else setLocalError("Не удалось сохранить");
      toastApiError(e, "Не удалось сохранить статью");
    }
  };

  const uploadImage = useCallback(async (file: File) => {
    const { url } = await uploadKnowledgeImage(file);
    return url;
  }, []);

  const breadcrumbs = useMemo(() => {
    const parts: { label: string; to?: string }[] = [{ label: "База знаний", to: "/knowledge" }];
    if (spaceId && space) parts.push({ label: space.name, to: `/knowledge/${spaceId}` });
    const all = articlesQuery.data ?? [];
    if (spaceId && articleId === "new") {
      if (parentId) {
        const p = all.find((a) => a.id === parentId);
        if (p) parts.push({ label: p.title, to: `/knowledge/${spaceId}/${p.id}` });
      }
      parts.push({ label: "Новая статья" });
      return parts;
    }
    if (spaceId && articleId && articleId !== "new" && article) {
      if (all.length) {
        const path = articlePathToRoot(all, articleId);
        for (let i = 0; i < path.length - 1; i++) {
          parts.push({ label: path[i].title, to: `/knowledge/${spaceId}/${path[i].id}` });
        }
        parts.push({ label: path[path.length - 1]?.title ?? article.title });
      } else {
        parts.push({ label: article.title });
      }
    }
    return parts;
  }, [spaceId, space, articleId, article, articlesQuery.data, parentId]);

  const spaces = spacesQuery.data ?? [];
  const filteredSpaces = useMemo(() => {
    const q = spaceSearchQ.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [spaces, spaceSearchQ]);
  const articles = articlesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const articleTree = useMemo(() => buildArticleTree(articles), [articles]);
  const filteredArticleTree = useMemo(() => {
    const q = sidebarArticleSearchQ.trim().toLowerCase();
    if (!q) return articleTree;
    const filterNodes = (nodes: ArticleTreeNode[]): ArticleTreeNode[] => {
      const out: ArticleTreeNode[] = [];
      for (const node of nodes) {
        const childMatches = filterNodes(node.children);
        const selfMatch = node.title.toLowerCase().includes(q);
        if (selfMatch || childMatches.length > 0) {
          out.push({ ...node, children: childMatches });
        }
      }
      return out;
    };
    return filterNodes(articleTree);
  }, [articleTree, sidebarArticleSearchQ]);
  const recentArticles = useMemo(
    () => [...articles].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 8),
    [articles],
  );
  const parentSelectOptions = useMemo(() => {
    if (!articleId || articleId === "new") {
      return flattenTreeForSelect(articleTree, { skipIds: new Set() });
    }
    const skip = collectDescendantIds(articles, articleId);
    return flattenTreeForSelect(articleTree, { skipIds: skip });
  }, [articleTree, articles, articleId]);
  const systemsOptions = systemsForSpaceQuery.data ?? [];
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  const memberIds = useMemo(
    () => new Set((membersQuery.data ?? []).map((m) => m.user_id)),
    [membersQuery.data],
  );
  const directoryCandidates = useMemo(
    () => (directoryQuery.data ?? []).filter((u) => !memberIds.has(u.id)),
    [directoryQuery.data, memberIds],
  );

  function submitCreateSpace(e: React.FormEvent) {
    e.preventDefault();
    const slug = newSpaceSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!slug) {
      toastError("Укажите slug: латиница, цифры и дефис");
      return;
    }
    createSpaceMut.mutate({
      name: newSpaceName.trim(),
      slug,
      description: newSpaceDescription.trim() || null,
      system_id: newSpaceSystemId || null,
    });
  }

  function applyTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    const tpl = templates.find((t) => t.id === nextTemplateId);
    if (!tpl) return;
    if (!title.trim()) setTitle(tpl.name);
    if (!slug.trim()) setSlug(slugify(tpl.name));
    if (!html || html === "<p></p>") setHtml(tpl.content || "<p></p>");
  }

  function toggleArticleCollapsed(id: string) {
    setCollapsedArticleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!spaceId) {
    return (
      <AppShell title="База знаний" subtitle="Пространства, к которым у вас есть доступ" wide>
        {errorRoot && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {errorRoot}
          </p>
        )}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <input
            type="search"
            value={spaceSearchQ}
            onChange={(e) => setSpaceSearchQ(e.target.value)}
            placeholder="Поиск пространства..."
            className="min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          {canManageSpaces && (
            <button
              type="button"
              onClick={() => setCreateSpaceOpen(true)}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
            >
              + Новое пространство
            </button>
          )}
        </div>
        {loadingRoot && <p className="text-slate-500">Загрузка…</p>}
        {!loadingRoot && !spaces.length && !canManageSpaces && (
          <p className="text-slate-600 dark:text-slate-400">
            Пока нет пространств. Обратитесь к администратору: нужно право{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">knowledge.manage.all</code> для создания
            первого пространства или приглашения в существующее.
          </p>
        )}
        {!loadingRoot && !spaces.length && canManageSpaces && (
          <p className="text-slate-600 dark:text-slate-400">
            Пространств пока нет. Нажмите «Новое пространство», чтобы создать базу знаний — вы станете её
            администратором.
          </p>
        )}
        {!loadingRoot && filteredSpaces.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSpaces.map((sp) => (
              <Link
                key={sp.id}
                to={`/knowledge/${sp.id}`}
                className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft transition hover:border-sky-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">{sp.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      sp.can_edit
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {sp.can_edit ? "Редактирование" : "Просмотр"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-slate-500">{sp.slug}</p>
                {sp.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{sp.description}</p>}
              </Link>
            ))}
          </div>
        )}
        {!loadingRoot && spaceSearchQ.trim() && filteredSpaces.length === 0 && (
          <p className="text-slate-500">По вашему поиску пространства не найдены.</p>
        )}

        {createSpaceOpen && canManageSpaces && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
              <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Новое пространство</h2>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                Отдельная «база» со статьями. Привязка к системе необязательна.
              </p>
              <form onSubmit={submitCreateSpace} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Название</label>
                  <input
                    required
                    value={newSpaceName}
                    onChange={(e) => {
                      setNewSpaceName(e.target.value);
                      setNewSpaceSlug(
                        e.target.value
                          .toLowerCase()
                          .trim()
                          .replace(/[^\w\s-]+/g, "")
                          .replace(/\s+/g, "-")
                          .replace(/-+/g, "-"),
                      );
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Slug (URL, латиница)</label>
                  <input
                    required
                    value={newSpaceSlug}
                    onChange={(e) =>
                      setNewSpaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Описание</label>
                  <textarea
                    value={newSpaceDescription}
                    onChange={(e) => setNewSpaceDescription(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Система (необязательно)</label>
                  <select
                    value={newSpaceSystemId}
                    onChange={(e) => setNewSpaceSystemId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">— не привязано —</option>
                    {systemsOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateSpaceOpen(false)}
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={createSpaceMut.isPending}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {createSpaceMut.isPending ? "Создание…" : "Создать"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  if (!articleId) {
    return (
      <AppShell title={space?.name ?? "Пространство"} subtitle="Статьи" wide>
        <nav className="mb-4 flex flex-wrap gap-2 text-sm text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-300">/</span>}
              {b.to ? (
                <Link to={b.to} className="text-sky-600 hover:underline dark:text-sky-400">
                  {b.label}
                </Link>
              ) : (
                <span className="text-slate-800 dark:text-slate-200">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
        {errorList && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {errorList}
          </p>
        )}
        {space?.can_manage_members && !spaceQuery.isPending && (
          <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Участники пространства</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Доступ к этому пространству задаётся по пользователям. Глобальные роли с правами{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">knowledge.read.all</code>{" "}
              или{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">knowledge.manage.all</code>{" "}
              действуют отдельно.
            </p>
            {membersQuery.isPending && <p className="text-sm text-slate-500">Загрузка участников…</p>}
            {membersQuery.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">Не удалось загрузить участников</p>
            )}
            {!membersQuery.isPending && !membersQuery.isError && (
              <>
                <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-left dark:border-slate-700 dark:bg-slate-800/50">
                        <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Пользователь</th>
                        <th className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Роль</th>
                        <th className="w-24 px-3 py-2 font-medium text-slate-600 dark:text-slate-400" />
                      </tr>
                    </thead>
                    <tbody>
                      {(membersQuery.data ?? []).map((m) => (
                        <tr key={m.user_id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900 dark:text-white">{m.full_name || m.email}</div>
                            <div className="font-mono text-xs text-slate-500">{m.email}</div>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={m.role}
                              onChange={(e) => {
                                const r = e.target.value as SpaceMemberRole;
                                if (r !== m.role) updateMemberRoleMut.mutate({ userId: m.user_id, role: r });
                              }}
                              disabled={updateMemberRoleMut.isPending}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                            >
                              {(["viewer", "editor", "admin"] as const).map((role) => (
                                <option key={role} value={role}>
                                  {SPACE_ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeMemberMut.mutate(m.user_id)}
                              disabled={removeMemberMut.isPending}
                              className="text-xs text-red-600 hover:underline dark:text-red-400"
                            >
                              Удалить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Добавить участника</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="search"
                      value={memberSearchQ}
                      onChange={(e) => setMemberSearchQ(e.target.value)}
                      placeholder="Поиск по email или имени (пусто — первые 50)"
                      className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                    <select
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value as SpaceMemberRole)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      {(["viewer", "editor", "admin"] as const).map((role) => (
                        <option key={role} value={role}>
                          {SPACE_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {directoryQuery.isPending && <p className="mt-2 text-xs text-slate-500">Поиск…</p>}
                  {!directoryQuery.isPending && directoryCandidates.length === 0 && (
                    <p className="mt-2 text-xs text-slate-500">Никого не найдено или все уже в пространстве</p>
                  )}
                  {!directoryQuery.isPending && directoryCandidates.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {directoryCandidates.slice(0, 12).map((u) => (
                        <li
                          key={u.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-800/30"
                        >
                          <span>
                            <span className="text-sm text-slate-900 dark:text-white">{u.full_name || u.email}</span>
                            <span className="ml-2 font-mono text-xs text-slate-500">{u.email}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              addMemberMut.mutate(
                                { userId: u.id, role: newMemberRole },
                                { onSuccess: () => setMemberSearchQ("") },
                              )
                            }
                            disabled={addMemberMut.isPending}
                            className="rounded-lg bg-sky-500 px-2 py-1 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-60"
                          >
                            Добавить
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
          <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            {!loadingList && canEdit && (
              <Link
                to={`/knowledge/${spaceId}/new`}
                className="inline-flex w-full justify-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
              >
                + Статья в корне
              </Link>
            )}
            {!loadingList && articleTree.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Навигация по статьям</h3>
                <input
                  type="search"
                  value={sidebarArticleSearchQ}
                  onChange={(e) => setSidebarArticleSearchQ(e.target.value)}
                  placeholder="Поиск по дереву..."
                  className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                />
                <ArticleTreeList
                  nodes={filteredArticleTree}
                  spaceId={spaceId!}
                  canEdit={!!canEdit}
                  onDeletePage={canEdit ? confirmDeletePage : undefined}
                  deletingArticleId={
                    deleteArticleMut.isPending && deleteArticleMut.variables != null
                      ? deleteArticleMut.variables
                      : null
                  }
                  collapsedIds={collapsedArticleIds}
                  onToggleCollapse={toggleArticleCollapsed}
                />
              </div>
            )}
            {!loadingList && recentArticles.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Последние изменения</h3>
                <ul className="space-y-1">
                  {recentArticles.map((a) => (
                    <li key={a.id} className="text-sm">
                      <Link to={`/knowledge/${spaceId}/${a.id}`} className="text-sky-600 hover:underline dark:text-sky-400">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          <div className="space-y-4">
            {loadingList && <p className="text-slate-500">Загрузка…</p>}
            {!loadingList && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                <label className="mb-1 block text-xs font-medium text-slate-500">Поиск по статьям пространства</label>
                <input
                  type="search"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Минимум 2 символа: заголовок или текст"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                {searchQ.trim().length >= 2 && (
                  <div className="mt-2 space-y-2">
                    {searchQuery.isPending && <p className="text-xs text-slate-500">Ищем…</p>}
                    {!searchQuery.isPending && (searchQuery.data ?? []).length === 0 && (
                      <p className="text-xs text-slate-500">Ничего не найдено</p>
                    )}
                    {(searchQuery.data ?? []).slice(0, 10).map((row) => (
                      <Link
                        key={row.article.id}
                        to={`/knowledge/${spaceId}/${row.article.id}`}
                        className="block rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-800/50"
                      >
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.article.title}</p>
                        {row.snippet && <p className="text-xs text-slate-500">{row.snippet}</p>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!loadingList && !articles.length && <p className="text-slate-500">В этом пространстве пока нет статей.</p>}
          </div>
        </div>
        {templateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
              <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Новый шаблон</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createTemplateMut.mutate({
                    name: newTemplateName.trim(),
                    slug: (newTemplateSlug.trim() || slugify(newTemplateName)).toLowerCase(),
                    content: html,
                    space_id: spaceId ?? null,
                  });
                }}
              >
                <input
                  required
                  value={newTemplateName}
                  onChange={(e) => {
                    setNewTemplateName(e.target.value);
                    if (!newTemplateSlug) setNewTemplateSlug(slugify(e.target.value));
                  }}
                  placeholder="Название шаблона"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  required
                  value={newTemplateSlug}
                  onChange={(e) => setNewTemplateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="slug"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setTemplateModalOpen(false)} className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700">Отмена</button>
                  <button type="submit" disabled={createTemplateMut.isPending} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {createTemplateMut.isPending ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {deletePageDialog}
      </AppShell>
    );
  }

  if (articleId === "new") {
    return (
      <AppShell title="Новая статья" subtitle={space?.name} wide>
        <nav className="mb-4 flex flex-wrap gap-2 text-sm text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-300">/</span>}
              {b.to ? (
                <Link to={b.to} className="text-sky-600 hover:underline dark:text-sky-400">
                  {b.label}
                </Link>
              ) : (
                <span className="text-slate-800 dark:text-slate-200">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
        {errorNew && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {errorNew}
          </p>
        )}
        {loadingNew && <p className="text-slate-500">Загрузка…</p>}
        {!loadingNew && space && (
          <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
            <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Навигация по статьям</h3>
                <input
                  type="search"
                  value={sidebarArticleSearchQ}
                  onChange={(e) => setSidebarArticleSearchQ(e.target.value)}
                  placeholder="Поиск по дереву..."
                  className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                />
                <ArticleTreeList
                  nodes={filteredArticleTree}
                  spaceId={spaceId!}
                  canEdit={!!canEdit}
                  collapsedIds={collapsedArticleIds}
                  onToggleCollapse={toggleArticleCollapsed}
                />
              </div>
            </aside>
            <div className="space-y-4">
            {localError && (
              <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {localError}
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Заголовок</label>
                  <input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setSlug(slugify(e.target.value));
                    }}
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Slug (URL)</label>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Шаблон</label>
                  <div className="flex gap-2">
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">— Без шаблона —</option>
                      {templates.map((t: KnowledgeTemplateOut) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setTemplateModalOpen(true)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                      >
                        + Шаблон
                      </button>
                    )}
                  </div>
                  {selectedTemplate?.content ? (
                    <p className="mt-1 text-xs text-slate-500">Шаблон применён к содержимому</p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <p className="mb-2 text-xs font-medium text-slate-500">Статус</p>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="draft">Черновик</option>
                  <option value="published">Опубликовано</option>
                </select>
              </div>
            </div>
            <ParentPageSelect
              value={parentId}
              onChange={setParentId}
              disabled={!canEdit}
              options={parentSelectOptions}
              pending={articlesQuery.isPending}
            />
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Содержание</p>
              <KnowledgeRichEditor
                articleKey={knowledgeEditorKey}
                initialHtml={html}
                editable={canEdit}
                onHtmlChange={setHtml}
                onUploadImage={uploadImage}
                onHeadingsChange={setTocHeadings}
              />
            </div>
            {tocHeadings.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/60">
                <p className="mb-2 text-xs font-medium text-slate-500">Оглавление</p>
                <ul className="space-y-1">
                  {tocHeadings.map((h) => (
                    <li key={`${h.id}-${h.text}`} className={h.level > 1 ? "ml-3 text-xs" : ""}>
                      {h.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canEdit && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReadingMode((v) => !v)}
                  className={`rounded-xl border px-4 py-2 text-sm ${
                    readingMode
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {readingMode ? "Сейчас: Чтение" : "Сейчас: Редактирование"}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/knowledge/${spaceId}`)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={createMut.isPending}
                  onClick={() => void handleSave()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {createMut.isPending ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            )}
            {!canEdit && (
              <p className="text-sm text-slate-500">У вас нет прав на редактирование в этом пространстве.</p>
            )}
            </div>
          </div>
        )}
        {deletePageDialog}
      </AppShell>
    );
  }

  return (
    <AppShell title={title || "Статья"} subtitle={space?.name} wide>
      {!showArticleReader && (
        <nav className="mb-4 flex flex-wrap gap-2 text-sm text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-300">/</span>}
              {b.to ? (
                <Link to={b.to} className="text-sky-600 hover:underline dark:text-sky-400">
                  {b.label}
                </Link>
              ) : (
                <span className="text-slate-800 dark:text-slate-200">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      {canEdit && !readingMode && (
        <div className="mb-4 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          Режим:{" "}
          <span className="font-semibold">
            {readingMode ? "Чтение" : "Редактирование"}
          </span>
        </div>
      )}
      {errorArticle && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {errorArticle}
        </p>
      )}
      {localError && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {localError}
        </p>
      )}
      {loadingArticle && <p className="text-slate-500">Загрузка…</p>}
      {!loadingArticle && (
        <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
          <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Навигация по статьям</h3>
              <ArticleTreeList
                nodes={filteredArticleTree}
                spaceId={spaceId!}
                canEdit={!!canEdit}
                onDeletePage={canEdit ? confirmDeletePage : undefined}
                deletingArticleId={
                  deleteArticleMut.isPending && deleteArticleMut.variables != null
                    ? deleteArticleMut.variables
                    : null
                }
                activeArticleId={articleId ?? null}
                collapsedIds={collapsedArticleIds}
                onToggleCollapse={toggleArticleCollapsed}
              />
            </div>
            {!showArticleReader && recentArticles.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Последние изменения</h3>
                <ul className="space-y-1">
                  {recentArticles.map((a) => (
                    <li key={a.id} className="text-sm">
                      <Link to={`/knowledge/${spaceId}/${a.id}`} className="text-sky-600 hover:underline dark:text-sky-400">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          <div className="space-y-4">
            {showArticleReader ? (
              <>
                {canEdit && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={deleteArticleMut.isPending || updateMut.isPending}
                      onClick={() =>
                        articleId &&
                        articleId !== "new" &&
                        confirmDeletePage(articleId, title.trim() || article?.title || "Страница")
                      }
                      className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      {deleteArticleMut.isPending ? "Удаление…" : "Удалить"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReadingMode(false)}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                    >
                      Редактировать
                    </button>
                    {!!articleId && articleId !== "new" && (
                      <button
                        type="button"
                        onClick={() => setRevisionsModalOpen(true)}
                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                      >
                        История версий
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/knowledge/${spaceId}`)}
                      className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                    >
                      Назад
                    </button>
                  </div>
                )}
                <header className="border-b border-slate-200/80 pb-6 dark:border-slate-700/80">
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                    {title || "Без заголовка"}
                  </h1>
                  {article && (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Обновлено {new Date(article.updated_at).toLocaleString("ru-RU")}
                      {" · "}
                      {status === "published" ? "Опубликовано" : "Черновик"}
                    </p>
                  )}
                </header>
                <div
                  className={
                    articleTocItems.length > 0
                      ? "grid gap-8 pt-2 lg:grid-cols-[minmax(0,1fr)_min(13rem,28%)]"
                      : "pt-2"
                  }
                >
                  <div className="min-w-0">
                    <KnowledgeArticleReader html={html} />
                  </div>
                  {articleTocItems.length > 0 && (
                    <aside className="max-h-[min(70vh,calc(100vh-7rem))] overflow-y-auto text-sm lg:sticky lg:top-24 lg:self-start">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">На странице</p>
                      <ul className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-600">
                        {articleTocItems.map((h) => (
                          <li
                            key={`${h.id}-${h.text}`}
                            className={h.level > 1 ? "ml-2 text-xs" : "text-[0.9375rem] leading-snug"}
                          >
                            <a
                              href={`#${h.id}`}
                              className="text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400"
                            >
                              {h.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </aside>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Заголовок</label>
                      <input
                        value={title}
                        onChange={(e) => {
                          setTitle(e.target.value);
                        }}
                        disabled={!canEdit}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                    <p className="mb-2 text-xs font-medium text-slate-500">Статус</p>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                      disabled={!canEdit}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="draft">Черновик</option>
                      <option value="published">Опубликовано</option>
                    </select>
                    {article && (
                      <p className="mt-3 text-xs text-slate-500">
                        Обновлено: {new Date(article.updated_at).toLocaleString("ru-RU")}
                      </p>
                    )}
                  </div>
                </div>
                <ParentPageSelect
                  value={parentId}
                  onChange={setParentId}
                  disabled={!canEdit}
                  options={parentSelectOptions}
                  pending={articlesQuery.isPending}
                />
                <div
                  className={
                    articleTocItems.length > 0
                      ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_min(240px,32%)]"
                      : ""
                  }
                >
                  <div className="min-w-0">
                    <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Содержание</p>
                    <KnowledgeRichEditor
                      articleKey={knowledgeEditorKey}
                      initialHtml={html}
                      editable={canEdit}
                      onHtmlChange={setHtml}
                      onUploadImage={uploadImage}
                      onHeadingsChange={setTocHeadings}
                    />
                  </div>
                  {articleTocItems.length > 0 && (
                    <aside className="max-h-[min(70vh,calc(100vh-7rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white/80 p-3 text-sm lg:sticky lg:top-24 lg:self-start dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="mb-2 text-xs font-medium text-slate-500">Оглавление</p>
                      <ul className="space-y-1">
                        {articleTocItems.map((h) => (
                          <li
                            key={`${h.id}-${h.text}`}
                            className={h.level > 1 ? "ml-3 text-xs" : "text-sm"}
                          >
                            {tocLinksEnabled ? (
                              <a
                                href={`#${h.id}`}
                                className="text-sky-600 hover:underline dark:text-sky-400"
                              >
                                {h.text}
                              </a>
                            ) : (
                              <span className="text-slate-700 dark:text-slate-200">{h.text}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </aside>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={deleteArticleMut.isPending || updateMut.isPending}
                      onClick={() =>
                        articleId &&
                        articleId !== "new" &&
                        confirmDeletePage(articleId, title.trim() || article?.title || "Страница")
                      }
                      className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      {deleteArticleMut.isPending ? "Удаление…" : "Удалить страницу"}
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setReadingMode((v) => !v)}
                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                      >
                        Чтение
                      </button>
                      {!!articleId && articleId !== "new" && (
                        <button
                          type="button"
                          onClick={() => setRevisionsModalOpen(true)}
                          className="rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
                        >
                          История версий
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(`/knowledge/${spaceId}`)}
                        className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                      >
                        Назад
                      </button>
                      <button
                        type="button"
                        disabled={updateMut.isPending}
                        onClick={() => void handleSave()}
                        className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                      >
                        {updateMut.isPending ? "Сохранение…" : "Сохранить"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {!canEdit && !showArticleReader && (
              <p className="text-sm text-slate-500">У вас нет прав на редактирование в этом пространстве.</p>
            )}
          </div>
        </div>
      )}
      {revisionsModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-lg rounded-2xl p-6 shadow-soft-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">История версий</h3>
              <button
                type="button"
                onClick={() => setRevisionsModalOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
            <div className="max-h-80 space-y-1 overflow-auto">
              {(revisionsQuery.data ?? []).length === 0 && (
                <p className="text-sm text-slate-500">Версий пока нет.</p>
              )}
              {(revisionsQuery.data ?? []).map((rev) => (
                <button
                  key={rev.id}
                  type="button"
                  disabled={!canEdit || restoreRevisionMut.isPending}
                  onClick={() =>
                    canEdit &&
                    spaceId &&
                    articleId &&
                    restoreRevisionMut.mutate(
                      { sid: spaceId, aid: articleId, rid: rev.id },
                      { onSuccess: () => setRevisionsModalOpen(false) },
                    )
                  }
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
                >
                  {new Date(rev.created_at).toLocaleString("ru-RU")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {deletePageDialog}
    </AppShell>
  );
}
