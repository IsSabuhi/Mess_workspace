import { apiFetch } from "./client";

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
  is_default: boolean;
  created_at: string;
  columns: KanbanColumnOut[];
};

export async function getDefaultBoard(): Promise<BoardOut> {
  return apiFetch<BoardOut>("/api/v1/boards/default");
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
