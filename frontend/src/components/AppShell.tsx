import { useEffect, useState, type ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const STORAGE_KEY = "mess-workspace-sidebar-collapsed";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Шире контент (канбан, БЗ) — меньше пустых полей по краям */
  wide?: boolean;
};

export function AppShell({ title, subtitle, children, wide }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const margin = collapsed ? "ml-[4.5rem]" : "ml-64";

  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
      <div className={`min-h-screen transition-[margin] duration-300 ease-out ${margin}`}>
        <div
          className={
            wide
              ? "mx-auto max-w-[min(100%,96rem)] px-3 pb-10 pt-4 sm:px-5 lg:px-6"
              : "mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-8"
          }
        >
          <TopBar title={title} subtitle={subtitle} />
          <main className="mt-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
