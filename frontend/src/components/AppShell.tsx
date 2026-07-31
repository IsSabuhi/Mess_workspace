import { useEffect, useState, type ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const STORAGE_KEY = "mess-workspace-sidebar-collapsed";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /**
   * Ранее сужал/расширял контент. Сейчас основная область всегда на всю ширину
   * рабочей зоны (удобно на 2K+); параметр оставлен для совместимости вызовов.
   */
  wide?: boolean;
  /**
   * Узкая колонка по центру — для форм (настройки профиля и т.п.).
   * Без этого контент занимает всю ширину между сайдбаром и краем окна.
   */
  narrow?: boolean;
};

export function AppShell({ title, subtitle, children, narrow }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const margin = collapsed ? "ml-[4.5rem]" : "ml-64";

  return (
    <div className="min-h-screen overflow-x-clip">
      <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      <div className={`min-h-screen min-w-0 overflow-x-clip transition-[margin] duration-300 ease-out ${margin}`}>
        <div
          className={
            narrow
              ? "mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6"
              : "w-full min-w-0 max-w-none px-3 pb-10 pt-4 sm:px-5 lg:px-6 xl:px-8 2xl:px-10"
          }
        >
          <TopBar title={title} subtitle={subtitle} />
          <main className="mt-6 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
