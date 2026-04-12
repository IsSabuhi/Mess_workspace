import type { UserMe } from "../api/auth";
import type { TaskOut } from "../api/tasks";

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
  return hasPermission(user, PERM.USERS_MANAGE) || hasPermission(user, PERM.ROLES_MANAGE);
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

/** Редактирование: полный доступ, либо право на «назначенные» — исполнитель или задача в своей производственной системе. */
export function canUpdateTask(user: UserMe, task: TaskOut): boolean {
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ALL)) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (task.assignee_id === user.id) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

/** Перенос по доске: право tasks.move или те же правила, что и для редактирования назначенных/в своих системах. */
export function canMoveTask(user: UserMe, task: TaskOut): boolean {
  if (user.is_superuser) return true;
  if (hasPermission(user, PERM.TASKS_MOVE)) return true;
  if (hasPermission(user, PERM.TASKS_UPDATE_ASSIGNED)) {
    if (task.assignee_id === user.id) return true;
    if (taskInUserSystems(user, task)) return true;
  }
  return false;
}

export function canDeleteTask(user: UserMe): boolean {
  return hasPermission(user, PERM.TASKS_DELETE);
}

export function canManageBoardColumns(user: UserMe): boolean {
  return hasPermission(user, PERM.BOARD_COLUMNS_MANAGE);
}
