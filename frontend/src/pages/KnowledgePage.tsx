import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Eye, EyeOff, Settings, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  addSpaceMember,
  createArticle,
  createKnowledgeSpace,
  createKnowledgeTemplate,
  deleteArticle,
  deleteKnowledgeSpace,
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
  updateKnowledgeSpace,
  updateSpaceMember,
  uploadKnowledgeImage,
} from "../api/knowledge";
import type {
  KnowledgeArticleCreate,
  KnowledgeArticleOut,
  KnowledgeArticleUpdate,
  KnowledgeSpaceUpdate,
  KnowledgeTemplateOut,
  SpaceMemberRole,
} from "../api/knowledge";
import { listSystems } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { KnowledgeArticleReader, extractTocFromArticleHtml } from "../components/KnowledgeArticleReader";
import { KnowledgeArticleTree } from "../components/KnowledgeArticleTree";
import { KnowledgeChildrenToc } from "../components/KnowledgeChildrenToc";
import { KnowledgeRevisionsModal } from "../components/KnowledgeRevisionsModal";
import { KnowledgeRichEditor } from "../components/KnowledgeRichEditor";
import { useAuth } from "../context/AuthContext";
import { PERM, hasPermission } from "../lib/permissions";
import {
  articlePathToRoot,
  buildArticleTree,
  collectDescendantIds,
  computeSiblingPositionsAfterMove,
  flattenTreeForSelect,
  getArticleChildrenTree,
  nextArticlePosition,
  pickDefaultSpaceArticleId,
  type ArticleTreeNode,
  type FlatOption,
} from "../lib/knowledgeTree";
import { invalidateAndRefetch } from "../lib/queryClient";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";
import { slugifyTitle, uniqueSlug } from "../lib/slugify";
import { useToastQueryError } from "../lib/useToastQueryError";
import { useModalLayer } from "../lib/useModalLayer";

const SPACE_ROLE_LABELS: Record<SpaceMemberRole, string> = {
  viewer: "Только просмотр",
  editor: "Редактор",
  admin: "Администратор",
};

/** Растягивается на широких экранах; minmax(0,1fr) не даёт горизонтальный скролл от длинного контента */
const KB_LAYOUT =
  "grid w-full min-w-0 gap-5 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]";
const KB_ASIDE = "min-w-0 space-y-3 overflow-hidden lg:sticky lg:top-24 lg:self-start";
const KB_MAIN = "min-w-0 space-y-4";

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
        Дочерние страницы показываются деревом в списке пространства. Корень — без родителя. При создании
        дочерней статьи у родителя автоматически появится оглавление со ссылками.
      </p>
    </div>
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
  const manageMembersLanding = searchParams.get("manage") === "members";
  const manageSettingsLanding = searchParams.get("manage") === "settings";
  const stayOnSpaceLanding = manageMembersLanding || manageSettingsLanding;

  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceSlug, setNewSpaceSlug] = useState("");
  const [newSpaceSlugManual, setNewSpaceSlugManual] = useState(false);
  const [newSpaceDescription, setNewSpaceDescription] = useState("");
  const [newSpaceSystemId, setNewSpaceSystemId] = useState("");

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  /** Пользователь правил slug вручную — больше не перезаписываем из заголовка */
  const [slugManual, setSlugManual] = useState(false);
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [html, setHtml] = useState("<p></p>");
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
  const [membersOpen, setMembersOpen] = useState(() => manageMembersLanding);
  const [spaceSettingsOpen, setSpaceSettingsOpen] = useState(() => manageSettingsLanding);
  const [editSpaceName, setEditSpaceName] = useState("");
  const [editSpaceDescription, setEditSpaceDescription] = useState("");
  const [editSpaceSystemId, setEditSpaceSystemId] = useState("");
  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false);
  const [deleteSpacePassword, setDeleteSpacePassword] = useState("");
  const [showDeleteSpacePassword, setShowDeleteSpacePassword] = useState(false);

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
    enabled: (!spaceId && canManageSpaces && createSpaceOpen) || (!!spaceId && spaceSettingsOpen),
  });

  const createSpaceMut = useMutation({
    mutationFn: createKnowledgeSpace,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
      setCreateSpaceOpen(false);
      setNewSpaceName("");
      setNewSpaceSlug("");
      setNewSpaceSlugManual(false);
      setNewSpaceDescription("");
      setNewSpaceSystemId("");
      toastSuccess("Пространство создано");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось создать пространство"),
  });

  const updateSpaceMut = useMutation({
    mutationFn: (body: KnowledgeSpaceUpdate) => updateKnowledgeSpace(spaceId!, body),
    onSuccess: async () => {
      toastSuccess("Настройки пространства сохранены");
      await qc.invalidateQueries({ queryKey: ["knowledge", "space", spaceId] });
      await qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить пространство"),
  });

  const deleteSpaceMut = useMutation({
    mutationFn: (password: string) => deleteKnowledgeSpace(spaceId!, password),
    onSuccess: async () => {
      toastSuccess("Пространство удалено");
      setDeleteSpaceOpen(false);
      setDeleteSpacePassword("");
      await qc.invalidateQueries({ queryKey: ["knowledge", "spaces"] });
      navigate("/knowledge");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить пространство"),
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
    enabled: !!spaceId && !!spaceQuery.data?.can_manage_members && membersOpen,
  });

  const directoryQuery = useQuery({
    queryKey: ["knowledge", "space", spaceId, "directory", memberSearchQ],
    queryFn: () => searchSpaceUsers(spaceId!, memberSearchQ),
    enabled: !!spaceId && !!spaceQuery.data?.can_manage_members && membersOpen,
  });

  const space = spaceQuery.data ?? null;

  useEffect(() => {
    if (!space) return;
    setEditSpaceName(space.name);
    setEditSpaceDescription(space.description ?? "");
    setEditSpaceSystemId(space.system_id ?? "");
  }, [space?.id, space?.name, space?.description, space?.system_id]);

  useToastQueryError(!spaceId ? spacesQuery.error : null, "Не удалось загрузить пространства");
  useToastQueryError(spaceId ? spaceQuery.error : null, "Не удалось загрузить пространство");
  useToastQueryError(spaceId ? articlesQuery.error : null, "Не удалось загрузить статьи");
  useToastQueryError(
    spaceId && articleId && articleId !== "new" ? articleQuery.error : null,
    "Не удалось загрузить статью",
  );
  useToastQueryError(space?.can_manage_members ? membersQuery.error : null, "Не удалось загрузить участников");

  useEffect(() => {
    if (articleId !== "new" && articleId) return;
    setTitle("");
    setSlug("");
    setSlugManual(false);
    setStatus("published");
    setHtml("<p></p>");
    setParentId(searchParams.get("parent") ?? "");
  }, [articleId, spaceId, searchParams]);

  useEffect(() => {
    if (!articleId || articleId === "new") return;
    const art = articleQuery.data;
    if (art && art.id === articleId) return;
    setTitle("");
    setSlug("");
    setSlugManual(false);
    setStatus("draft");
    setHtml("<p></p>");
  }, [articleId, articleQuery.data]);

  useEffect(() => {
    if (!articleId || articleId === "new") return;
    const art = articleQuery.data;
    if (!art || art.id !== articleId) return;
    setTitle(art.title);
    setSlug(art.slug);
    setSlugManual(true);
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
      if (created.parent_id) {
        void qc.invalidateQueries({
          queryKey: ["knowledge", "space", vars.sid, "article", created.parent_id],
        });
      }
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
      if (updated.parent_id) {
        void qc.invalidateQueries({
          queryKey: ["knowledge", "space", v.sid, "article", updated.parent_id],
        });
      }
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
      const prevArticles = qc.getQueryData<KnowledgeArticleOut[]>(articlesKey);
      const deletedParentId = prevArticles?.find((a) => a.id === aid)?.parent_id ?? null;
      qc.setQueryData<KnowledgeArticleOut[]>(articlesKey, (prev) => {
        if (!prev) return prev;
        return prev
          .filter((a) => a.id !== aid)
          .map((a) => (a.parent_id === aid ? { ...a, parent_id: null } : a));
      });
      void qc.removeQueries({ queryKey: ["knowledge", "space", spaceId, "article", aid] });
      await invalidateAndRefetch(qc, articlesKey);
      if (deletedParentId) {
        void qc.invalidateQueries({
          queryKey: ["knowledge", "space", spaceId, "article", deletedParentId],
        });
      }
      toastSuccess("Страница удалена");
      if (articleId && articleId !== "new" && articleId === aid) {
        navigate(`/knowledge/${spaceId}`);
      }
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить страницу"),
  });

  const [movingArticleId, setMovingArticleId] = useState<string | null>(null);

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
      toastError("Укажите заголовок");
      return;
    }
    let sl = (slug.trim() || slugifyTitle(t, "article")).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!sl) sl = slugifyTitle(t, "article");
    if (!/^[a-z0-9-]+$/.test(sl)) {
      toastError("Slug: только латиница, цифры и дефис");
      return;
    }
    if (isNew) {
      sl = uniqueSlug(
        sl,
        articles.map((a) => a.slug),
        "article",
      );
    }
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
            position: nextArticlePosition(articles, parentId || null),
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

  const moveArticleInTree = useCallback(
    async (aid: string, direction: "up" | "down") => {
      if (!spaceId || !canEdit) return;
      const current = articles.find((a) => a.id === aid);
      if (!current) return;
      const siblings = articles.filter((a) => a.parent_id === current.parent_id);
      const nextPositions = computeSiblingPositionsAfterMove(siblings, aid, direction);
      if (!nextPositions) return;

      const byId = new Map(articles.map((a) => [a.id, a]));
      const changes = nextPositions.filter((row) => byId.get(row.id)?.position !== row.position);
      if (!changes.length) return;

      setMovingArticleId(aid);
      const key = ["knowledge", "space", spaceId, "articles"] as const;
      const prev = qc.getQueryData<KnowledgeArticleOut[]>(key);
      qc.setQueryData<KnowledgeArticleOut[]>(key, (old) => {
        if (!old) return old;
        const posMap = new Map(nextPositions.map((r) => [r.id, r.position]));
        return old.map((a) => (posMap.has(a.id) ? { ...a, position: posMap.get(a.id)! } : a));
      });

      try {
        await Promise.all(
          changes.map((row) => updateArticle(spaceId, row.id, { position: row.position })),
        );
        await invalidateAndRefetch(qc, key);
        if (current.parent_id) {
          void qc.invalidateQueries({
            queryKey: ["knowledge", "space", spaceId, "article", current.parent_id],
          });
        }
      } catch (e) {
        if (prev) qc.setQueryData(key, prev);
        toastApiError(e, "Не удалось изменить порядок");
      } finally {
        setMovingArticleId(null);
      }
    },
    [articles, canEdit, qc, spaceId],
  );

  const childTree = useMemo(() => {
    if (!articleId || articleId === "new" || !articles.length) return [];
    return getArticleChildrenTree(articles, articleId);
  }, [articleId, articles]);
  const articleTree = useMemo(() => buildArticleTree(articles), [articles]);
  const defaultSpaceArticleId = useMemo(() => {
    if (articleId || stayOnSpaceLanding) return null;
    if (!articlesQuery.isSuccess) return null;
    return pickDefaultSpaceArticleId(articleTree);
  }, [articleId, stayOnSpaceLanding, articlesQuery.isSuccess, articleTree]);
  const redirectingToDefaultArticle =
    !!spaceId && !articleId && !stayOnSpaceLanding && !!defaultSpaceArticleId;
  const spaceLandingBusy = loadingList || redirectingToDefaultArticle;

  useEffect(() => {
    if (!redirectingToDefaultArticle || !spaceId || !defaultSpaceArticleId) return;
    navigate(`/knowledge/${spaceId}/${defaultSpaceArticleId}`, { replace: true });
  }, [redirectingToDefaultArticle, spaceId, defaultSpaceArticleId, navigate]);

  useEffect(() => {
    if (manageMembersLanding) setMembersOpen(true);
  }, [manageMembersLanding]);

  useEffect(() => {
    if (manageSettingsLanding) setSpaceSettingsOpen(true);
  }, [manageSettingsLanding]);

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

  const membersPanelBody = (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {space?.system_id
          ? "Сотрудники привязанной системы автоматически входят в участники (чтение). Роль можно повысить. Удалить сотрудника системы нельзя — только убрать его из системы или сменить привязку пространства."
          : "Доступ задаётся по пользователям. При привязке пространства к системе её сотрудники попадут сюда автоматически."}{" "}
        Редактирование статей — только роли{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">editor</code> /{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">admin</code> в этом
        списке. Глобальное{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
          knowledge.read.all
        </code>{" "}
        даёт только чтение всех пространств;{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
          knowledge.manage.all
        </code>{" "}
        — создание пространств и глобальных шаблонов, без правки чужих баз.
      </p>
      {membersQuery.isPending && <p className="text-sm text-slate-500">Загрузка участников…</p>}
      {!membersQuery.isPending && !membersQuery.isError && (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">
                          {m.full_name || m.email}
                        </span>
                        {m.is_system_member && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                            из системы
                          </span>
                        )}
                      </div>
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
                      {m.is_system_member ? (
                        <span className="text-[11px] text-slate-400" title="Сотрудник системы пространства">
                          —
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeMemberMut.mutate(m.user_id)}
                          disabled={removeMemberMut.isPending}
                          className="text-xs text-red-600 hover:underline dark:text-red-400"
                        >
                          Удалить
                        </button>
                      )}
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
  );

  const spaceSettingsFields = space ? (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Название</label>
        <input
          value={editSpaceName}
          onChange={(e) => setEditSpaceName(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Описание</label>
        <textarea
          value={editSpaceDescription}
          onChange={(e) => setEditSpaceDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Система</label>
        <select
          value={editSpaceSystemId}
          onChange={(e) => setEditSpaceSystemId(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">— без системы —</option>
          {(systemsForSpaceQuery.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Slug: <span className="font-mono">{space.slug}</span> (не меняется)
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={updateSpaceMut.isPending || !editSpaceName.trim()}
          onClick={() =>
            updateSpaceMut.mutate({
              name: editSpaceName.trim(),
              description: editSpaceDescription.trim() || null,
              system_id: editSpaceSystemId || null,
            })
          }
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {updateSpaceMut.isPending ? "Сохранение…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleteSpacePassword("");
            setDeleteSpaceOpen(true);
          }}
          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Удалить пространство…
        </button>
      </div>
    </div>
  ) : null;

  const spaceSearchPanel = spaceId ? (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Поиск по статьям
      </label>
      <input
        type="search"
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        placeholder="Минимум 2 символа: заголовок или текст"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800"
      />
      {searchQ.trim().length >= 2 && (
        <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
          {searchQuery.isPending && <p className="text-xs text-slate-500">Ищем…</p>}
          {!searchQuery.isPending && (searchQuery.data ?? []).length === 0 && (
            <p className="text-xs text-slate-500">Ничего не найдено</p>
          )}
          {(searchQuery.data ?? []).slice(0, 12).map((row) => (
            <Link
              key={row.article.id}
              to={`/knowledge/${spaceId}/${row.article.id}`}
              onClick={() => setSearchQ("")}
              className="block min-w-0 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-sky-700"
            >
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                {row.article.title}
              </p>
              {row.snippet && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {row.snippet}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  ) : null;

  function submitCreateSpace(e: React.FormEvent) {
    e.preventDefault();
    const slug =
      newSpaceSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") ||
      slugifyTitle(newSpaceName, "space");
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      toastError("Не удалось сформировать slug из названия");
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
    if (!slug.trim()) { setSlug(slugifyTitle(tpl.name, "article")); setSlugManual(false); }
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

  const closeCreateSpaceModal = useCallback(() => setCreateSpaceOpen(false), []);
  const closeTemplateModal = useCallback(() => setTemplateModalOpen(false), []);
  const closeRevisionsModal = useCallback(() => setRevisionsModalOpen(false), []);
  const closeDeleteSpaceModal = useCallback(() => {
    if (deleteSpaceMut.isPending) return;
    setDeleteSpaceOpen(false);
    setDeleteSpacePassword("");
    setShowDeleteSpacePassword(false);
  }, [deleteSpaceMut.isPending]);

  const { backdropProps: rootSpaceModalBackdrop, stopPanelPointer: rootSpaceModalPanelStop } = useModalLayer(
    !spaceId && canManageSpaces && createSpaceOpen,
    closeCreateSpaceModal,
    {
      closeOnEscape: !createSpaceMut.isPending,
      closeOnBackdrop: !createSpaceMut.isPending,
    },
  );
  const { backdropProps: tplModalBackdrop, stopPanelPointer: tplModalPanelStop } = useModalLayer(
    !!spaceId && !articleId && templateModalOpen,
    closeTemplateModal,
    {
      closeOnEscape: !createTemplateMut.isPending,
      closeOnBackdrop: !createTemplateMut.isPending,
    },
  );
  const { backdropProps: deleteSpaceBackdrop, stopPanelPointer: deleteSpacePanelStop } = useModalLayer(
    !!spaceId && deleteSpaceOpen,
    closeDeleteSpaceModal,
    {
      closeOnEscape: !deleteSpaceMut.isPending,
      closeOnBackdrop: !deleteSpaceMut.isPending,
    },
  );

  const deleteSpaceDialog =
    deleteSpaceOpen && space ? (
      <div
        {...deleteSpaceBackdrop}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
      >
        <div
          className="modal-panel w-full max-w-md rounded-2xl p-6 shadow-soft-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-space-title"
          onClick={deleteSpacePanelStop}
        >
          <h2 id="delete-space-title" className="text-lg font-semibold text-slate-900 dark:text-white">
            Удалить пространство?
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Будет удалено пространство <strong>«{space.name}»</strong> вместе со всеми статьями, версиями и
            участниками. Действие необратимо.
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-800 dark:text-slate-200">
            Пароль вашей учётной записи
            <div className="relative mt-1.5">
              <input
                type={showDeleteSpacePassword ? "text" : "password"}
                autoComplete="current-password"
                value={deleteSpacePassword}
                onChange={(e) => setDeleteSpacePassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-11 text-sm dark:border-slate-600 dark:bg-slate-800"
                placeholder="Введите пароль для подтверждения"
              />
              <button
                type="button"
                onClick={() => setShowDeleteSpacePassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400"
                title={showDeleteSpacePassword ? "Скрыть пароль" : "Показать пароль"}
                aria-label={showDeleteSpacePassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showDeleteSpacePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteSpaceModal}
              disabled={deleteSpaceMut.isPending}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!deleteSpacePassword || deleteSpaceMut.isPending}
              onClick={() => deleteSpaceMut.mutate(deleteSpacePassword)}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteSpaceMut.isPending ? "Удаление…" : "Удалить навсегда"}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (!spaceId) {
    return (
      <AppShell title="База знаний" wide>
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredSpaces.map((sp) => (
              <Link
                key={sp.id}
                to={`/knowledge/${sp.id}`}
                className="group flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft transition hover:border-sky-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/60"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate font-semibold text-slate-900 group-hover:text-sky-700 dark:text-white dark:group-hover:text-sky-300">
                    {sp.name}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      sp.can_edit
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {sp.can_edit ? "Редактирование" : "Просмотр"}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-slate-500">{sp.slug}</p>
                {sp.description && (
                  <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{sp.description}</p>
                )}
              </Link>
            ))}
          </div>
        )}
        {!loadingRoot && spaceSearchQ.trim() && filteredSpaces.length === 0 && (
          <p className="text-slate-500">По вашему поиску пространства не найдены.</p>
        )}

        {createSpaceOpen && canManageSpaces && (
          <div
            {...rootSpaceModalBackdrop}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          >
            <div
              className="modal-panel w-full max-w-md rounded-2xl p-6 shadow-soft-lg"
              role="dialog"
              aria-modal="true"
              onClick={rootSpaceModalPanelStop}
            >
              <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Новое пространство</h2>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                Отдельная «база» со статьями. Если выбрать систему — все её сотрудники сразу станут участниками (чтение).
              </p>
              <form onSubmit={submitCreateSpace} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Название</label>
                  <input
                    required
                    value={newSpaceName}
                    onChange={(e) => {
                      setNewSpaceName(e.target.value);
                      if (!newSpaceSlugManual) {
                        setNewSpaceSlug(slugifyTitle(e.target.value, "space"));
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Slug (URL)
                    <span className="ml-1 font-normal text-slate-400">— из названия, можно изменить</span>
                  </label>
                  <input
                    required
                    value={newSpaceSlug}
                    onChange={(e) => {
                      setNewSpaceSlugManual(true);
                      setNewSpaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                    placeholder="avtomaticheski-iz-nazvaniya"
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
                    onClick={closeCreateSpaceModal}
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
{space?.can_manage_members && !spaceQuery.isPending && (
          <div className="mb-6 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
            <button
              type="button"
              onClick={() => setMembersOpen((v) => !v)}
              aria-expanded={membersOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                <Users className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                  Участники пространства
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {membersOpen
                    ? "Управление доступом к пространству"
                    : "Нажмите, чтобы открыть список и добавить участников"}
                </span>
              </span>
              {membersOpen && !membersQuery.isPending && (membersQuery.data?.length ?? 0) > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {membersQuery.data!.length}
                </span>
              )}
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                  membersOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                membersOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="border-t border-slate-200/80 px-4 pb-4 pt-3 dark:border-slate-700">
                  {membersPanelBody}
                </div>
              </div>
            </div>
          </div>
        )}
        {space?.can_manage_members && !spaceQuery.isPending && (
          <div className="mb-6 min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
            <button
              type="button"
              onClick={() => setSpaceSettingsOpen((v) => !v)}
              aria-expanded={spaceSettingsOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Settings className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                  Настройки пространства
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  Название, описание, система; удаление пространства
                </span>
              </span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                  spaceSettingsOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                spaceSettingsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="border-t border-slate-200/80 px-4 pb-4 pt-3 dark:border-slate-700">
                  {spaceSettingsFields}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className={KB_LAYOUT}>
          <aside className={KB_ASIDE}>
            {!spaceLandingBusy && canEdit && (
              <Link
                to={`/knowledge/${spaceId}/new`}
                className="inline-flex w-full justify-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
              >
                + Статья в корне
              </Link>
            )}
            {!spaceLandingBusy && articleTree.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 p-3 shadow-soft dark:border-slate-700 dark:from-slate-900/70 dark:to-slate-950/40 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Навигация
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {articles.length}
                  </span>
                </div>
                <input
                  type="search"
                  value={sidebarArticleSearchQ}
                  onChange={(e) => setSidebarArticleSearchQ(e.target.value)}
                  placeholder="Поиск по дереву..."
                  className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <KnowledgeArticleTree
                  nodes={filteredArticleTree}
                  spaceId={spaceId!}
                  canEdit={!!canEdit}
                  onDeletePage={canEdit ? confirmDeletePage : undefined}
                  onMoveArticle={
                    canEdit && !sidebarArticleSearchQ.trim() ? moveArticleInTree : undefined
                  }
                  deletingArticleId={
                    deleteArticleMut.isPending && deleteArticleMut.variables != null
                      ? deleteArticleMut.variables
                      : null
                  }
                  movingArticleId={movingArticleId}
                  collapsedIds={collapsedArticleIds}
                  onToggleCollapse={toggleArticleCollapsed}
                />
              </div>
            )}
            {!spaceLandingBusy && recentArticles.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Последние изменения</h3>
                <ul className="space-y-1">
                  {recentArticles.map((a) => (
                    <li key={a.id} className="min-w-0 text-sm">
                      <Link
                        to={`/knowledge/${spaceId}/${a.id}`}
                        className="block truncate text-sky-600 hover:underline dark:text-sky-400"
                        title={a.title}
                      >
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          <div className={KB_MAIN}>
            {spaceLandingBusy && <p className="text-slate-500">Загрузка…</p>}
            {!spaceLandingBusy && manageMembersLanding && articleTree.length > 0 && (
              <div className="mb-4 rounded-xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                <p className="font-medium">Управление участниками пространства</p>
                <Link
                  to={`/knowledge/${spaceId}/${pickDefaultSpaceArticleId(articleTree)}`}
                  className="mt-1 inline-block text-sky-700 underline hover:no-underline dark:text-sky-300"
                >
                  Открыть первую страницу →
                </Link>
              </div>
            )}
            {!spaceLandingBusy && manageSettingsLanding && articleTree.length > 0 && (
              <div className="mb-4 rounded-xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                <p className="font-medium">Настройки пространства</p>
                <p className="mt-1 text-sky-800/90 dark:text-sky-200/90">
                  Раздел открыт выше — название, описание, система и удаление.
                </p>
                <Link
                  to={`/knowledge/${spaceId}/${pickDefaultSpaceArticleId(articleTree)}`}
                  className="mt-1 inline-block text-sky-700 underline hover:no-underline dark:text-sky-300"
                >
                  Открыть первую страницу →
                </Link>
              </div>
            )}
            {!spaceLandingBusy && !articles.length && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-10 text-center dark:border-slate-600 dark:bg-slate-900/40">
                <p className="text-base font-semibold text-slate-900 dark:text-white">Пока нет статей</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Создайте первую родительскую страницу — на ней появится оглавление дочерних разделов.
                </p>
                {canEdit && (
                  <Link
                    to={`/knowledge/${spaceId}/new`}
                    className="mt-5 inline-flex rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                  >
                    Создать первую статью
                  </Link>
                )}
              </div>
            )}
            {!spaceLandingBusy && articles.length > 0 && !stayOnSpaceLanding && (
              <p className="text-sm text-slate-500">Открываем первую страницу…</p>
            )}
          </div>
        </div>
        {templateModalOpen && (
          <div
            {...tplModalBackdrop}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          >
            <div
              className="modal-panel w-full max-w-md rounded-2xl p-6 shadow-soft-lg"
              role="dialog"
              aria-modal="true"
              onClick={tplModalPanelStop}
            >
              <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Новый шаблон</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createTemplateMut.mutate({
                    name: newTemplateName.trim(),
                    slug: (newTemplateSlug.trim() || slugifyTitle(newTemplateName, "template")).toLowerCase(),
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
                    if (!newTemplateSlug) setNewTemplateSlug(slugifyTitle(e.target.value, "template"));
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
                  <button type="button" onClick={closeTemplateModal} className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700">Отмена</button>
                  <button type="submit" disabled={createTemplateMut.isPending} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {createTemplateMut.isPending ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {deletePageDialog}
        {deleteSpaceDialog}
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
{loadingNew && <p className="text-slate-500">Загрузка…</p>}
        {!loadingNew && space && (
          <div className={KB_LAYOUT}>
            <aside className={KB_ASIDE}>
              {spaceSearchPanel}
              <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 p-3 shadow-soft dark:border-slate-700 dark:from-slate-900/70 dark:to-slate-950/40 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Навигация
                  </h3>
                </div>
                <input
                  type="search"
                  value={sidebarArticleSearchQ}
                  onChange={(e) => setSidebarArticleSearchQ(e.target.value)}
                  placeholder="Поиск по дереву..."
                  className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <KnowledgeArticleTree
                  nodes={filteredArticleTree}
                  spaceId={spaceId!}
                  canEdit={!!canEdit}
                  onMoveArticle={
                    canEdit && !sidebarArticleSearchQ.trim() ? moveArticleInTree : undefined
                  }
                  movingArticleId={movingArticleId}
                  collapsedIds={collapsedArticleIds}
                  onToggleCollapse={toggleArticleCollapsed}
                />
              </div>
            </aside>
            <div className={KB_MAIN}>
<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)]">
              <div className="min-w-0 space-y-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Заголовок</label>
                  <input
                    value={title}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTitle(next);
                      if (!slugManual) setSlug(slugifyTitle(next, "article"));
                    }}
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-sm text-slate-600 dark:text-slate-400">
                      Slug (URL)
                      <span className="ml-1 font-normal text-slate-400">— сам из заголовка</span>
                    </label>
                    {canEdit && slugManual && (
                      <button
                        type="button"
                        onClick={() => {
                          setSlugManual(false);
                          setSlug(slugifyTitle(title, "article"));
                        }}
                        className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        Снова из заголовка
                      </button>
                    )}
                  </div>
                  <input
                    value={slug}
                    onChange={(e) => {
                      setSlugManual(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                    disabled={!canEdit}
                    placeholder="instrukciya-po-nastrojke"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600 dark:text-slate-400">Шаблон</label>
                  <div className="flex min-w-0 gap-2">
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
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
                        className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800"
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
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Содержание</p>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Большое поле ниже — основной текст статьи. Кликните в область и начинайте писать.
              </p>
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
        {deleteSpaceDialog}
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
{loadingArticle && <p className="text-slate-500">Загрузка…</p>}
      {!loadingArticle && (
        <div className={KB_LAYOUT}>
          <aside className={KB_ASIDE}>
            {spaceSearchPanel}
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 p-3 shadow-soft dark:border-slate-700 dark:from-slate-900/70 dark:to-slate-950/40 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Навигация
                </h3>
              </div>
              <KnowledgeArticleTree
                nodes={filteredArticleTree}
                spaceId={spaceId!}
                canEdit={!!canEdit}
                onDeletePage={canEdit ? confirmDeletePage : undefined}
                onMoveArticle={
                  canEdit && !sidebarArticleSearchQ.trim() ? moveArticleInTree : undefined
                }
                deletingArticleId={
                  deleteArticleMut.isPending && deleteArticleMut.variables != null
                    ? deleteArticleMut.variables
                    : null
                }
                movingArticleId={movingArticleId}
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
                    <li key={a.id} className="min-w-0 text-sm">
                      <Link
                        to={`/knowledge/${spaceId}/${a.id}`}
                        className="block truncate text-sky-600 hover:underline dark:text-sky-400"
                        title={a.title}
                      >
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          <div className={KB_MAIN}>
            {showArticleReader ? (
              <>
                {(canEdit || space?.can_manage_members) && (
                  <div className="mb-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canEdit && (
                        <>
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
                        </>
                      )}
                      {space?.can_manage_members && (
                        <button
                          type="button"
                          onClick={() => setMembersOpen((v) => !v)}
                          aria-expanded={membersOpen}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition ${
                            membersOpen
                              ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          }`}
                        >
                          <Users className="h-4 w-4 shrink-0" />
                          Участники
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 transition-transform ${membersOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                      {space?.can_manage_members && (
                        <button
                          type="button"
                          onClick={() => setSpaceSettingsOpen((v) => !v)}
                          aria-expanded={spaceSettingsOpen}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition ${
                            spaceSettingsOpen
                              ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          }`}
                        >
                          <Settings className="h-4 w-4 shrink-0" />
                          Настройки
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 transition-transform ${spaceSettingsOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => navigate(`/knowledge/${spaceId}`)}
                          className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                        >
                          Назад
                        </button>
                      )}
                    </div>
                    {space?.can_manage_members && (
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                          membersOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                                Участники пространства
                              </h2>
                              {!membersQuery.isPending && (membersQuery.data?.length ?? 0) > 0 && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {membersQuery.data!.length}
                                </span>
                              )}
                            </div>
                            {membersPanelBody}
                          </div>
                        </div>
                      </div>
                    )}
                    {space?.can_manage_members && (
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                          spaceSettingsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                              Настройки пространства
                            </h2>
                            {spaceSettingsFields}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-6 shadow-soft sm:px-8 sm:py-8 xl:px-10 dark:border-slate-700 dark:bg-slate-900/50">
                  <header className="border-b border-slate-200/80 pb-6 dark:border-slate-700/80">
                    <h1 className="break-words text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                      {title || "Без заголовка"}
                    </h1>
                    {article && (
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Обновлено {new Date(article.updated_at).toLocaleString("ru-RU")}
                        {" · "}
                        {status === "published" ? "Опубликовано" : "Черновик"}
                        {article.created_by?.full_name
                          ? ` · Автор: ${article.created_by.full_name}`
                          : article.created_by?.email
                            ? ` · Автор: ${article.created_by.email}`
                            : ""}
                      </p>
                    )}
                  </header>
                  {childTree.length > 0 ? (
                    <KnowledgeChildrenToc spaceId={spaceId!} nodes={childTree} className="mt-6" />
                  ) : (
                    <div
                      className={
                        articleTocItems.length > 0
                          ? "grid min-w-0 gap-8 pt-6 xl:grid-cols-[minmax(0,1fr)_minmax(11rem,15rem)]"
                          : "pt-6"
                      }
                    >
                      <div className="min-w-0">
                        <KnowledgeArticleReader html={html} />
                      </div>
                      {articleTocItems.length > 0 && (
                        <aside className="max-h-[min(70vh,calc(100vh-7rem))] min-w-0 overflow-y-auto text-sm xl:sticky xl:top-24 xl:self-start">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                            На странице
                          </p>
                          <ul className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-600">
                            {articleTocItems.map((h) => (
                              <li
                                key={`${h.id}-${h.text}`}
                                className={h.level > 1 ? "ml-2 text-xs" : "text-[0.9375rem] leading-snug"}
                              >
                                <a
                                  href={`#${h.id}`}
                                  className="break-words text-slate-600 hover:text-sky-600 dark:text-slate-300 dark:hover:text-sky-400"
                                >
                                  {h.text}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </aside>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)]">
                  <div className="min-w-0 space-y-3">
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
                        {article.created_by?.full_name
                          ? ` · Автор: ${article.created_by.full_name}`
                          : article.created_by?.email
                            ? ` · Автор: ${article.created_by.email}`
                            : ""}
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
                      ? "grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]"
                      : "min-w-0"
                  }
                >
                  <div className="min-w-0">
                    <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Содержание</p>
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
                    <aside className="max-h-[min(70vh,calc(100vh-7rem))] min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-white/80 p-3 text-sm xl:sticky xl:top-24 xl:self-start dark:border-slate-700 dark:bg-slate-900/60">
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
                                className="break-words text-sky-600 hover:underline dark:text-sky-400"
                              >
                                {h.text}
                              </a>
                            ) : (
                              <span className="break-words text-slate-700 dark:text-slate-200">{h.text}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </aside>
                  )}
                </div>
                {canEdit && (
                  <div className="mb-2 space-y-3">
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
                        {space?.can_manage_members && (
                          <button
                            type="button"
                            onClick={() => setMembersOpen((v) => !v)}
                            aria-expanded={membersOpen}
                            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition ${
                              membersOpen
                                ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            }`}
                          >
                            <Users className="h-4 w-4 shrink-0" />
                            Участники
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 transition-transform ${membersOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                        )}
                        {space?.can_manage_members && (
                          <button
                            type="button"
                            onClick={() => setSpaceSettingsOpen((v) => !v)}
                            aria-expanded={spaceSettingsOpen}
                            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition ${
                              spaceSettingsOpen
                                ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            }`}
                          >
                            <Settings className="h-4 w-4 shrink-0" />
                            Настройки
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 transition-transform ${spaceSettingsOpen ? "rotate-180" : ""}`}
                            />
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
                    {space?.can_manage_members && (
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                          membersOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                                Участники пространства
                              </h2>
                              {!membersQuery.isPending && (membersQuery.data?.length ?? 0) > 0 && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {membersQuery.data!.length}
                                </span>
                              )}
                            </div>
                            {membersPanelBody}
                          </div>
                        </div>
                      </div>
                    )}
                    {space?.can_manage_members && (
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                          spaceSettingsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                              Настройки пространства
                            </h2>
                            {spaceSettingsFields}
                          </div>
                        </div>
                      </div>
                    )}
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
      <KnowledgeRevisionsModal
        open={revisionsModalOpen}
        onClose={closeRevisionsModal}
        revisions={revisionsQuery.data ?? []}
        loading={revisionsQuery.isPending}
        current={{
          title,
          content: html,
          status,
          parent_id: parentId || null,
        }}
        canRestore={!!canEdit}
        restoring={restoreRevisionMut.isPending}
        parentTitleById={new Map(articles.map((a) => [a.id, a.title]))}
        onRestore={(rid) => {
          if (!spaceId || !articleId || articleId === "new") return;
          restoreRevisionMut.mutate(
            { sid: spaceId, aid: articleId, rid },
            { onSuccess: () => setRevisionsModalOpen(false) },
          );
        }}
      />

      {deletePageDialog}
      {deleteSpaceDialog}
    </AppShell>
  );
}
