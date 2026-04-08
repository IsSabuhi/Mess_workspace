import type { ReactNode } from "react";

import { AppShell } from "../components/AppShell";

type Props = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
};

export function PlaceholderPage({ title, subtitle, children }: Props) {
  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-10 text-center dark:border-slate-600 dark:bg-slate-900/40">
        {children ?? (
          <p className="text-slate-600 dark:text-slate-300">Раздел в разработке — макет готов, API подключим далее.</p>
        )}
      </div>
    </AppShell>
  );
}
