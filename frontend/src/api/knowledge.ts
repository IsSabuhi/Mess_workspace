import { apiFetch } from "./client";

export type KnowledgeSpaceOut = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  system_id: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_manage_members: boolean;
};

export type SpaceMemberRole = "viewer" | "editor" | "admin";

export type SpaceMemberOut = {
  user_id: string;
  email: string;
  full_name: string;
  role: SpaceMemberRole;
};

export type KnowledgeDirectoryUser = {
  id: string;
  email: string;
  full_name: string;
};

export type KnowledgeSpaceCreate = {
  name: string;
  slug: string;
  description?: string | null;
  system_id?: string | null;
};

export async function createKnowledgeSpace(body: KnowledgeSpaceCreate): Promise<KnowledgeSpaceOut> {
  return apiFetch<KnowledgeSpaceOut>("/api/v1/knowledge/spaces", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ArticleStatus = "draft" | "published";

export type KnowledgeArticleOut = {
  id: string;
  space_id: string;
  title: string;
  slug: string;
  content: string | null;
  parent_id: string | null;
  status: ArticleStatus;
  position: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeArticleCreate = {
  title: string;
  slug: string;
  content?: string | null;
  parent_id?: string | null;
  status?: ArticleStatus;
  position?: number;
};

export type KnowledgeArticleUpdate = {
  title?: string;
  content?: string | null;
  parent_id?: string | null;
  status?: ArticleStatus;
  position?: number;
};

export async function listKnowledgeSpaces(): Promise<KnowledgeSpaceOut[]> {
  return apiFetch<KnowledgeSpaceOut[]>("/api/v1/knowledge/spaces");
}

export async function getKnowledgeSpace(spaceId: string): Promise<KnowledgeSpaceOut> {
  return apiFetch<KnowledgeSpaceOut>(`/api/v1/knowledge/spaces/${spaceId}`);
}

export async function listSpaceMembers(spaceId: string): Promise<SpaceMemberOut[]> {
  return apiFetch<SpaceMemberOut[]>(`/api/v1/knowledge/spaces/${spaceId}/members`);
}

export async function searchSpaceUsers(spaceId: string, q = ""): Promise<KnowledgeDirectoryUser[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return apiFetch<KnowledgeDirectoryUser[]>(`/api/v1/knowledge/spaces/${spaceId}/user-directory${qs}`);
}

export async function addSpaceMember(
  spaceId: string,
  body: { user_id: string; role: SpaceMemberRole },
): Promise<void> {
  await apiFetch(`/api/v1/knowledge/spaces/${spaceId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSpaceMember(
  spaceId: string,
  userId: string,
  body: { role: SpaceMemberRole },
): Promise<SpaceMemberOut> {
  return apiFetch<SpaceMemberOut>(`/api/v1/knowledge/spaces/${spaceId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function removeSpaceMember(spaceId: string, userId: string): Promise<void> {
  await apiFetch(`/api/v1/knowledge/spaces/${spaceId}/members/${userId}`, {
    method: "DELETE",
  });
}

export async function listArticles(spaceId: string): Promise<KnowledgeArticleOut[]> {
  return apiFetch<KnowledgeArticleOut[]>(`/api/v1/knowledge/spaces/${spaceId}/articles`);
}

export async function getArticle(spaceId: string, articleId: string): Promise<KnowledgeArticleOut> {
  return apiFetch<KnowledgeArticleOut>(`/api/v1/knowledge/spaces/${spaceId}/articles/${articleId}`);
}

export async function createArticle(
  spaceId: string,
  body: KnowledgeArticleCreate,
): Promise<KnowledgeArticleOut> {
  return apiFetch<KnowledgeArticleOut>(`/api/v1/knowledge/spaces/${spaceId}/articles`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateArticle(
  spaceId: string,
  articleId: string,
  body: KnowledgeArticleUpdate,
): Promise<KnowledgeArticleOut> {
  return apiFetch<KnowledgeArticleOut>(`/api/v1/knowledge/spaces/${spaceId}/articles/${articleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteArticle(spaceId: string, articleId: string): Promise<void> {
  await apiFetch(`/api/v1/knowledge/spaces/${spaceId}/articles/${articleId}`, {
    method: "DELETE",
  });
}

export async function uploadKnowledgeImage(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<{ url: string }>("/api/v1/knowledge/upload", {
    method: "POST",
    body: fd,
  });
}
