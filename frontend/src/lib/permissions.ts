import type { UserMe } from "../api/auth";
import type { TaskOut } from "../api/tasks";

import { taskHasAssignee } from "./taskAssignees";

export const PERM = {
  USERS_MANAGE: "users.manage",
  USERS_CREATE: "users.create",
  USERS_PASSWORD_RESET: "users.password.reset",
  USERS_DELETE: "users.delete",
  ROLES_MANAGE: "roles.manage",
  ADMIN_SETTINGS: "admin.settings.manage",
  ADMIN_BACKUPS: "admin.backups.manage",
  ADMIN_AUDIT: "admin.audit.read",
  ADMIN_IMPORT_USERS: "admin.import.users",
  ADMIN_IMPORT_TASKS: "admin.import.tasks",
  ADMIN_IMPORT_VACATIONS: "admin.import.vacations",
  ADMIN_IMPORT_KNOWLEDGE: "admin.import.knowledge",
  ADMIN_IMPORT_USPD: "admin.import.uspd",
  SYSTEMS_MANAGE: "systems.manage",
  POSITIONS_MANAGE: "positions.manage",
  TASKS_CREATE: "tasks.create",
  TASKS_READ_ALL: "tasks.read.all",
  TASKS_UPDATE_ALL: "tasks.update.all",
  TASKS_UPDATE_ASSIGNED: "tasks.update.assigned",
  TASKS_MOVE: "tasks.move",
  TASKS_DELETE: "tasks.delete",
  BOARD_COLUMNS_MANAGE: "board.columns.manage",
  BOARDS_CREATE: "boards.create",
  KNOWLEDGE_MANAGE_ALL: "knowledge.manage.all",
  KNOWLEDGE_SPACE_MANAGE: "knowledge.space.manage",
  EMPLOYEE_DIRECTORY_READ: "employee_directory.read",
  EMPLOYEE_DIRECTORY_MANAGE: "employee_directory.manage",
  EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE: "employee_directory.compliance.manage",
  EMPLOYEE_DIRECTORY_PROFILE_MANAGE: "employee_directory.profile.manage",
  SCHEDULE_READ: "schedule.read",
  SCHEDULE_MANAGE: "schedule.manage",
} as const;

/** Права, которые открывают раздел «Администрирование». */
export const ADMIN_SECTION_CODES: readonly string[] = [
  PERM.USERS_MANAGE,
  PERM.USERS_CREATE,
  PERM.USERS_PASSWORD_RESET,
  PERM.USERS_DELETE,
  PERM.ROLES_MANAGE,
  PERM.ADMIN_SETTINGS,
  PERM.ADMIN_BACKUPS,
  PERM.ADMIN_AUDIT,
  PERM.ADMIN_IMPORT_USERS,
  PERM.ADMIN_IMPORT_TASKS,
  PERM.ADMIN_IMPORT_VACATIONS,
  PERM.ADMIN_IMPORT_KNOWLEDGE,
  PERM.ADMIN_IMPORT_USPD,
];

const ADMIN_SECTION_SET = new Set(ADMIN_SECTION_CODES);

export function hasPermission(user: UserMe, code: string): boolean {
  return user.is_superuser || user.permissions.includes(code);
}

/** Просмотр таблицы графика: отдельное право или право на редактирование. */
export function canViewSchedule(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.SCHEDULE_READ) ||
    hasPermission(user, PERM.SCHEDULE_MANAGE)
  );
}

/** Раздел «Администрирование»: любое узкое право админки. */
export function canAdminAccess(user: UserMe): boolean {
  return user.is_superuser || ADMIN_SECTION_CODES.some((code) => user.permissions.includes(code));
}

export function canStaffUsers(user: UserMe): boolean {
  return (
    hasPermission(user, PERM.USERS_MANAGE) ||
    hasPermission(user, PERM.USERS_CREATE) ||
    hasPermission(user, PERM.USERS_PASSWORD_RESET) ||
    hasPermission(user, PERM.USERS_DELETE)
  );
}

export function canCreateUsers(user: UserMe): boolean {
  return hasPermission(user, PERM.USERS_MANAGE) || hasPermission(user, PERM.USERS_CREATE);
}

export function canUpdateUsers(user: UserMe): boolean {
  return hasPermission(user, PERM.USERS_MANAGE);
}

export function canResetUserPassword(user: UserMe): boolean {
  return hasPermission(user, PERM.USERS_MANAGE) || hasPermission(user, PERM.USERS_PASSWORD_RESET);
}

export function canDeleteUsers(user: UserMe): boolean {
  return hasPermission(user, PERM.USERS_MANAGE) || hasPermission(user, PERM.USERS_DELETE);
}

export function actorPrivilegedCodes(user: UserMe): Set<string> {
  if (user.is_superuser) return new Set(ADMIN_SECTION_CODES);
  const have = new Set(user.permissions);
  if (have.has(PERM.USERS_MANAGE)) {
    have.add(PERM.USERS_CREATE);
    have.add(PERM.USERS_PASSWORD_RESET);
    have.add(PERM.USERS_DELETE);
  }
  return new Set([...have].filter((code) => ADMIN_SECTION_SET.has(code)));
}

export function canAssignRole(
  user: UserMe,
  role: { slug: string; permissions: { code: string }[] },
): boolean {
  if (user.is_superuser) return true;
  if (role.slug === "super_admin") return false;
  const actor = actorPrivilegedCodes(user);
  return !role.permissions.some((p) => ADMIN_SECTION_SET.has(p.code) && !actor.has(p.code));
}

export function canToggleAdminPermission(user: UserMe, code: string): boolean {
  if (user.is_superuser) return true;
  if (!ADMIN_SECTION_SET.has(code)) return true;
  return actorPrivilegedCodes(user).has(code);
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

/** Создание кастомных (системных) досок. */
export function canCreateBoards(user: UserMe): boolean {
  return user.is_superuser || hasPermission(user, PERM.BOARDS_CREATE);
}

const USPD_SYSTEM_SLUG = "smzis";

function foldSystemLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}

/** Система «СМЗиС(ЗФ и НТЭК)» — slug в справочнике `smzis`. */
export function isSmzisZfNtekSystem(system: { name?: string | null; slug?: string | null }): boolean {
  if ((system.slug || "").trim().toLowerCase() === USPD_SYSTEM_SLUG) return true;
  const blob = foldSystemLabel(system.name || "");
  return blob.includes("смзис") && (blob.includes("зф") || blob.includes("нтэк"));
}

/** Справочник УСПД: суперпользователь или сотрудник СМЗиС (ЗФ и НТЭК). */
export function canViewUspd(user: UserMe): boolean {
  if (user.is_superuser) return true;
  return (user.systems ?? []).some(isSmzisZfNtekSystem);
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
  if (hasPermission(user, PERM.TASKS_UPDATE_ALL)) return true;
  if (board?.scope === "system") {
    if (systemBoardAllowsEdit(board)) return true;
    if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
      if (taskHasAssignee(task, user.id)) return true;
      if (taskInUserSystems(user, task)) return true;
    }
    return false;
  }
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (taskHasAssignee(task, user.id)) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

function systemBoardAllowsEdit(ctx: BoardPermissionContext): boolean {
  return ctx.memberRole === "editor" || ctx.memberRole === "manager";
}

function canSeeAllTasks(user: UserMe): boolean {
  return (
    user.is_superuser ||
    hasPermission(user, PERM.TASKS_READ_ALL) ||
    hasPermission(user, PERM.TASKS_UPDATE_ALL)
  );
}

/** Создание задачи на доске. */
export function canCreateTaskOnBoard(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (!hasPermission(user, PERM.TASKS_CREATE) && board?.scope !== "system") return false;
  if (board?.scope === "system") {
    if (systemBoardAllowsEdit(board)) return true;
    // Руководитель: создавать на чужих системных досках при праве на все задачи.
    return hasPermission(user, PERM.TASKS_CREATE) && canSeeAllTasks(user);
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

/** Создание/редактирование глобальных тегов задач (структура доски). */
export function canManageTaskTags(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.BOARD_COLUMNS_MANAGE)) return true;
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

/** Перенос по доске. На системной доске — редактор/менеджер или глобальные права. */
export function canMoveTask(user: UserMe, task: TaskOut, board?: BoardPermissionContext): boolean {
  if (user.is_superuser) return true;
  if (board?.scope === "system") {
    if (systemBoardAllowsEdit(board)) return true;
    if (hasPermission(user, PERM.TASKS_MOVE) || hasPermission(user, PERM.TASKS_UPDATE_ALL)) return true;
    if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
      if (taskHasAssignee(task, user.id)) return true;
      if (taskInUserSystems(user, task)) return true;
    }
    return false;
  }
  if (hasPermission(user, PERM.TASKS_MOVE)) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (taskHasAssignee(task, user.id)) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

/** Удаление задачи. На системной доске — менеджер доски или глобальное tasks.delete. */
export function canDeleteTask(user: UserMe, board?: BoardPermissionContext): boolean {
  if (globalBoardLockedBlocksFullEdit(user, board)) return false;
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.TASKS_DELETE)) return true;
  if (board?.scope === "system") {
    return board.memberRole === "manager";
  }
  return false;
}

/** Комментарии к задаче (доступны и при блокировке доски). */
export function canCommentOnTask(_user: UserMe, _board?: BoardPermissionContext): boolean {
  return true;
}

export function canManageBoardColumns(user: UserMe): boolean {
  return hasPermission(user, PERM.BOARD_COLUMNS_MANAGE);
}
