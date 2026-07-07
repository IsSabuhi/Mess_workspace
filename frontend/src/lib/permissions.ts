import type { UserMe } from "../api/auth";
import type { TaskOut } from "../api/tasks";

import { taskHasAssignee } from "./taskAssignees";

export const PERM = {
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  SYSTEMS_MANAGE: "systems.manage",
  POSITIONS_MANAGE: "positions.manage",
  TASKS_CREATE: "tasks.create",
  TASKS_READ_ALL: "tasks.read.all",
  TASKS_UPDATE_ALL: "tasks.update.all",
  TASKS_UPDATE_ASSIGNED: "tasks.update.assigned",
  TASKS_MOVE: "tasks.move",
  TASKS_DELETE: "tasks.delete",
  BOARD_COLUMNS_MANAGE: "board.columns.manage",
  KNOWLEDGE_MANAGE_ALL: "knowledge.manage.all",
  KNOWLEDGE_SPACE_MANAGE: "knowledge.space.manage",
  EMPLOYEE_DIRECTORY_READ: "employee_directory.read",
  EMPLOYEE_DIRECTORY_MANAGE: "employee_directory.manage",
  EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE: "employee_directory.compliance.manage",
  EMPLOYEE_DIRECTORY_PROFILE_MANAGE: "employee_directory.profile.manage",
  SCHEDULE_READ: "schedule.read",
  SCHEDULE_MANAGE: "schedule.manage",
} as const;

export function hasPermission(user: UserMe, code: string): boolean {
  return user.is_superuser || user.permissions.includes(code);
}

/** Просмотр таблицы расписания: отдельное право или право на редактирование. */
export function canViewSchedule(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.SCHEDULE_READ) ||
    hasPermission(user, PERM.SCHEDULE_MANAGE)
  );
}

export function canAdminAccess(user: UserMe): boolean {
  return (
    hasPermission(user, PERM.USERS_MANAGE) ||
    hasPermission(user, PERM.ROLES_MANAGE) ||
    hasPermission(user, PERM.SYSTEMS_MANAGE)
  );
}

/** Сводки и аналитика по задачам всей команды (главная /team-dashboard). */
export function canViewManagerTeamDashboard(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.TASKS_READ_ALL) ||
    hasPermission(user, PERM.TASKS_UPDATE_ALL) ||
    hasPermission(user, PERM.USERS_MANAGE)
  );
}

export function canEmployeeDirectoryAccess(user: UserMe): boolean {
  return (
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ) ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_MANAGE) ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE) ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_PROFILE_MANAGE)
  );
}

export function canEmployeeDirectoryComplianceEdit(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_MANAGE) ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE)
  );
}

export function canEmployeeDirectoryProfileEdit(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_MANAGE) ||
    hasPermission(user, PERM.EMPLOYEE_DIRECTORY_PROFILE_MANAGE)
  );
}

function taskInUserSystems(user: UserMe, task: TaskOut): boolean {
  return (user.systems ?? []).some((s) => s.id === task.system_id);
}

export type BoardMemberRole = "viewer" | "editor" | "manager";

/** Контекст доски для проверок прав (роль участника + блокировка основной доски). */
export type BoardPermissionContext = {
  scope: "global" | "system";
  memberRole: BoardMemberRole | null;
  isEditingLocked?: boolean;
};

export function boardPermissionContext(
  board: { scope: "global" | "system"; is_editing_locked?: boolean } | null | undefined,
  memberRole: BoardMemberRole | null,
): BoardPermissionContext | undefined {
  if (!board) return undefined;
  return { scope: board.scope, memberRole, isEditingLocked: !!board.is_editing_locked };
}

function isGlobalBoardLocked(board?: BoardPermissionContext): boolean {
  return board?.scope === "global" && !!board.isEditingLocked;
}

/** Админ/руководитель: может снимать блокировку и редактировать заблокированную доску. */
export function canBypassBoardEditingLock(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.USERS_MANAGE) ||
    hasPermission(user, PERM.TASKS_UPDATE_ALL) ||
    hasPermission(user, PERM.BOARD_COLUMNS_MANAGE)
  );
}

export function canManageBoardEditingLock(user: UserMe): boolean {
  return canBypassBoardEditingLock(user);
}

function globalBoardLockedBlocksFullEdit(user: UserMe, board?: BoardPermissionContext): boolean {
  return isGlobalBoardLocked(board) && !canBypassBoardEditingLock(user);
}

function hasTaskEditPermission(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  if (user.is_superuser) return true;
  if (board?.scope === "system") {
    return systemBoardAllowsEdit(board);
  }
  if (hasPermission(user, PERM.TASKS_UPDATE_ALL)) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (taskHasAssignee(task, user.id)) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

function systemBoardAllowsEdit(ctx: BoardPermissionContext): boolean {
  return ctx.memberRole === "editor" || ctx.memberRole === "manager";
}

/** Создание задачи на доске. */
export function canCreateTaskOnBoard(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (board?.scope === "system") {
    return systemBoardAllowsEdit(board);
  }
  return hasPermission(user, PERM.TASKS_CREATE);
}

/** Управление колонками доски. */
export function canManageBoardColumnsOnBoard(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.BOARD_COLUMNS_MANAGE)) return true;
  if (board?.scope === "system") {
    return systemBoardAllowsEdit(board);
  }
  return false;
}

/** Создание/редактирование глобальных тегов задач. */
export function canManageTaskTags(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.TASKS_CREATE)) return true;
  if (board?.scope === "system") {
    return systemBoardAllowsEdit(board);
  }
  return false;
}

/** Полное редактирование задачи (все поля). При блокировке — только админ/руководитель. */
export function canFullyEditTask(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  if (!hasTaskEditPermission(user, task, board)) return false;
  return !globalBoardLockedBlocksFullEdit(user, board);
}

/** Редактирование заголовка. При блокировке основной доски недоступно сотрудникам. */
export function canEditTaskTitle(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  return canFullyEditTask(user, task, board);
}

/** Редактирование описания. Доступно и при блокировке доски. */
export function canEditTaskDescription(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  return hasTaskEditPermission(user, task, board);
}

/** @deprecated Используйте canFullyEditTask для полного редактирования. */
export function canUpdateTask(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  return canFullyEditTask(user, task, board);
}

/** Перенос по доске. На системной доске — только редактор/менеджер. */
export function canMoveTask(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  if (user.is_superuser) return true;
  if (board?.scope === "system") {
    return systemBoardAllowsEdit(board);
  }
  if (hasPermission(user, PERM.TASKS_MOVE)) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (taskHasAssignee(task, user.id)) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

/** Удаление задачи. На системной доске — только менеджер. */
export function canDeleteTask(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (board?.scope === "system") {
    return board.memberRole === "manager";
  }
  return hasPermission(user, PERM.TASKS_DELETE);
}

/** Комментарии к задаче (доступны и при блокировке доски). */
export function canCommentOnTask(_user: UserMe, _board?: BoardPermissionContext): boolean {
  return true;
}

export function canManageBoardColumns(user: UserMe): boolean {
  return hasPermission(user, PERM.BOARD_COLUMNS_MANAGE);
}
