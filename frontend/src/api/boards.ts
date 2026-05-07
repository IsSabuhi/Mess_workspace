import { apiFetch } from "./client";
import type { AuditEventOut } from "./audit";

export type KanbanColumnOut = {
  id: string;
  board_id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_system_column: boolean;
  /** На доске только одна колонка может быть «выполнено» для отчётов */
  is_done_column: boolean;
  created_at: string;
};

export type BoardOut = {
  id: string;
  name: string;
  slug: string;
  scope: "global" | "system";
  system_id: string | null;
  system_name: string | null;
  is_default: boolean;
  is_archived: boolean;
  created_at: string;
  columns: KanbanColumnOut[];
};

export async function getDefaultBoard(): Promise<BoardOut> {
  return apiFetch<BoardOut>("/api/v1/boards/default");
}

export type BoardMemberOut = {
  id: string;
  board_id: string;
  user_id: string;
  role: "viewer" | "editor" | "manager";
  created_at: string;
};

export async function listBoards(): Promise<BoardOut[]> {
  return apiFetch<BoardOut[]>("/api/v1/boards");
}

export async function createBoard(body: {
  name: string;
  slug: string;
  scope: "global" | "system";
  system_id?: string | null;
}): Promise<BoardOut> {
  return apiFetch<BoardOut>("/api/v1/boards", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteBoard(boardId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/boards/${boardId}`, { method: "DELETE" });
}

export async function updateBoard(boardId: string, body: { name?: string }): Promise<BoardOut> {
  return apiFetch<BoardOut>(`/api/v1/boards/${boardId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function listBoardAudit(boardId: string): Promise<AuditEventOut[]> {
  return apiFetch<AuditEventOut[]>(`/api/v1/boards/${boardId}/audit`);
}

export async function listBoardMembers(boardId: string): Promise<BoardMemberOut[]> {
  return apiFetch<BoardMemberOut[]>(`/api/v1/boards/${boardId}/members`);
}

export async function replaceBoardMembers(
  boardId: string,
  members: Array<{ user_id: string; role: "viewer" | "editor" | "manager" }>,
): Promise<BoardMemberOut[]> {
  return apiFetch<BoardMemberOut[]>(`/api/v1/boards/${boardId}/members`, {
    method: "PUT",
    body: JSON.stringify({ members }),
  });
}

export type KanbanColumnCreate = {
  name: string;
  slug: string;
  sort_order?: number;
  is_done_column?: boolean;
};

export type KanbanColumnUpdate = {
  name?: string;
  sort_order?: number;
  is_done_column?: boolean;
};

export async function createBoardColumn(boardId: string, body: KanbanColumnCreate): Promise<KanbanColumnOut> {
  return apiFetch<KanbanColumnOut>(`/api/v1/boards/${boardId}/columns`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteBoardColumn(boardId: string, columnId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/boards/${boardId}/columns/${columnId}`, { method: "DELETE" });
}

export async function updateBoardColumn(
  boardId: string,
  columnId: string,
  body: KanbanColumnUpdate,
): Promise<KanbanColumnOut> {
  return apiFetch<KanbanColumnOut>(`/api/v1/boards/${boardId}/columns/${columnId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
