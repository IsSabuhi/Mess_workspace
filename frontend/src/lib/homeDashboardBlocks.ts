import type { DashboardPreferences } from "../api/auth";

/** Совпадает с ALLOWED_HOME_DASHBOARD_BLOCK_IDS на бэкенде */
export const HOME_DASHBOARD_BLOCK_IDS = [
  "employee_expiry",
  "my_tasks_panel",
  "employee_focus",
  "manager_approval",
  "manager_team_overdue",
  "manager_by_system",
  "manager_analytics",
  "manager_own_tasks",
] as const;

export type HomeDashboardBlockId = (typeof HOME_DASHBOARD_BLOCK_IDS)[number];

/** false в prefs.home[id] = блок скрыт; отсутствие ключа = показывать */
export function isHomeBlockVisible(
  prefs: DashboardPreferences | null | undefined,
  blockId: string,
): boolean {
  return prefs?.home?.[blockId] !== false;
}
