import { Copy, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { UspdSiteOut } from "../api/uspd";
import { SearchableSelect } from "./SearchableSelect";
import {
  SIM_ISSUE_LABEL,
  collectSimReport,
  simHasDup,
  simIsComplete,
  summarizeSimReport,
  type SimIssue,
  type SimReportRow,
} from "../lib/uspdSimReport";

const th =
  "sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300";
const td = "border-b border-slate-100 px-2.5 py-1.5 align-middle text-sm dark:border-slate-800";

type Completeness = "all" | "complete" | "incomplete" | "no_number" | "no_ip" | "no_iccid" | "dups";
type SortKey = "site" | "parent" | "number" | "ip" | "iccid";

const COMPLETENESS: { id: Completeness; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "complete", label: "Полные" },
  { id: "incomplete", label: "Неполные" },
  { id: "no_number", label: "Без номера" },
  { id: "no_ip", label: "Без IP" },
  { id: "no_iccid", label: "Без ICCID" },
  { id: "dups", label: "Дубли" },
];

function issueClass(issue: SimIssue): string {
  if (issue.startsWith("dup_")) return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  if (issue === "no_number") return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200";
  if (issue === "no_ip") return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function Copyable({ value }: { value: string }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1 font-mono text-[13px]">
      <span className="truncate">{value}</span>
      <button
        type="button"
        title="Копировать"
        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        onClick={() => void navigator.clipboard.writeText(value)}
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  active,
  warn,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  warn?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition ${
        active
          ? "border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950/40"
          : "border-slate-200 bg-white hover:border-sky-200 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-sky-800"
      }`}
    >
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${warn && value > 0 ? "text-amber-700 dark:text-amber-300" : "text-slate-900 dark:text-white"}`}>
        {value}
      </p>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </button>
  );
}

function SortBtn({
  col,
  current,
  dir,
  onSort,
  children,
}: {
  col: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  children: string;
}) {
  const active = current === col;
  return (
    <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort(col)}>
      {children}
      {active ? <span className="text-[10px] text-sky-600">{dir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

export function UspdSimReportPanel({
  sites,
  pending,
  onOpenSite,
}: {
  sites: UspdSiteOut[];
  pending: boolean;
  onOpenSite: (siteId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [siteId, setSiteId] = useState("");
  const [completeness, setCompleteness] = useState<Completeness>("all");
  const [sortKey, setSortKey] = useState<SortKey>("site");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [exporting, setExporting] = useState(false);

  const { rows, gaps } = useMemo(() => collectSimReport(sites), [sites]);
  const stats = useMemo(() => summarizeSimReport(rows, gaps), [rows, gaps]);

  const siteItems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.siteId)) seen.set(r.siteId, r.siteName);
    }
    for (const g of gaps) {
      if (!seen.has(g.siteId)) seen.set(g.siteId, g.siteName);
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [rows, gaps]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (siteId) list = list.filter((r) => r.siteId === siteId);
    if (completeness === "complete") list = list.filter(simIsComplete);
    else if (completeness === "incomplete") list = list.filter((r) => !simIsComplete(r));
    else if (completeness === "no_number") list = list.filter((r) => r.issues.includes("no_number"));
    else if (completeness === "no_ip") list = list.filter((r) => r.issues.includes("no_ip"));
    else if (completeness === "no_iccid") list = list.filter((r) => r.issues.includes("no_iccid"));
    else if (completeness === "dups") list = list.filter(simHasDup);
    if (needle) {
      list = list.filter((r) =>
        [r.siteName, r.section, r.parentObject, r.parentIp, r.simLabel, r.simNumber, r.simIp, r.simIccid, r.comment]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    const mul = sortDir === "asc" ? 1 : -1;
    const val = (r: SimReportRow) => {
      if (sortKey === "parent") return r.parentObject;
      if (sortKey === "number") return r.simNumber;
      if (sortKey === "ip") return r.simIp;
      if (sortKey === "iccid") return r.simIccid;
      return r.siteName;
    };
    return [...list].sort((a, b) => mul * val(a).localeCompare(val(b), "ru", { numeric: true }));
  }, [rows, q, siteId, completeness, sortKey, sortDir]);

  const shownGaps = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return gaps.filter((g) => {
      if (siteId && g.siteId !== siteId) return false;
      if (!needle) return true;
      return [g.siteName, g.section, g.object, g.ip, g.comment].join(" ").toLowerCase().includes(needle);
    });
  }, [gaps, q, siteId]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { downloadUspdSimExcel } = await import("../lib/exportUspdSimExcel");
      await downloadUspdSimExcel({ rows: filtered, gaps: shownGaps });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Всего SIM" value={stats.total} active={completeness === "all"} onClick={() => setCompleteness("all")} />
        <Kpi label="С номером" value={stats.withNumber} hint={`из ${stats.total}`} />
        <Kpi label="С IP" value={stats.withIp} hint={`из ${stats.total}`} />
        <Kpi label="С ICCID" value={stats.withIccid} hint={`из ${stats.total}`} />
        <Kpi
          label="Неполные"
          value={stats.incomplete}
          warn
          active={completeness === "incomplete"}
          onClick={() => setCompleteness("incomplete")}
        />
        <Kpi label="Дубли" value={stats.dups} warn active={completeness === "dups"} onClick={() => setCompleteness("dups")} />
        <Kpi label="GSM без SIM" value={stats.gaps} warn />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Номер, ICCID, IP, объект, устройство…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2.5 text-sm outline-none ring-sky-400/30 focus:border-sky-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <SearchableSelect
          value={siteId}
          onChange={setSiteId}
          items={siteItems}
          emptyLabel="Все объекты"
          searchPlaceholder="Объект УСПД…"
        />
        <div className="flex flex-wrap gap-1">
          {COMPLETENESS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCompleteness(item.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                completeness === item.id
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={exporting || (!filtered.length && !shownGaps.length)}
          onClick={() => void exportExcel()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Excel…" : "Excel"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Показано {filtered.length} из {rows.length} SIM
        {shownGaps.length ? ` · GSM без SIM: ${shownGaps.length}` : ""}
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-slate-700 dark:bg-slate-900">
        {pending && <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>}
        {!pending && rows.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            Пока нет SIM-карт. Их добавляют в карточке GSM / телефониса на вкладке «Объекты».
          </p>
        )}
        {!pending && rows.length > 0 && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">Ничего не найдено по фильтрам</p>
        )}
        {!pending && filtered.length > 0 && (
          <div className="max-h-[calc(100vh-22rem)] overflow-auto">
            <table className="w-full min-w-[72rem] border-collapse">
              <thead>
                <tr>
                  <th className={th}>
                    <SortBtn col="site" current={sortKey} dir={sortDir} onSort={onSort}>
                      Объект УСПД
                    </SortBtn>
                  </th>
                  <th className={th}>Раздел</th>
                  <th className={th}>
                    <SortBtn col="parent" current={sortKey} dir={sortDir} onSort={onSort}>
                      Где стоит
                    </SortBtn>
                  </th>
                  <th className={th}>SIM</th>
                  <th className={th}>
                    <SortBtn col="number" current={sortKey} dir={sortDir} onSort={onSort}>
                      Номер
                    </SortBtn>
                  </th>
                  <th className={th}>
                    <SortBtn col="ip" current={sortKey} dir={sortDir} onSort={onSort}>
                      IP SIM
                    </SortBtn>
                  </th>
                  <th className={th}>
                    <SortBtn col="iccid" current={sortKey} dir={sortDir} onSort={onSort}>
                      ICCID
                    </SortBtn>
                  </th>
                  <th className={th}>PIN / PUK</th>
                  <th className={th}>Комментарий</th>
                  <th className={th}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => onOpenSite(r.siteId)}
                        className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                      >
                        {r.siteName}
                      </button>
                    </td>
                    <td className={`${td} text-slate-500`}>{r.section || "—"}</td>
                    <td className={td}>
                      <div className="leading-tight">
                        <div>{r.parentObject}</div>
                        {r.parentIp ? <div className="font-mono text-[11px] text-slate-400">{r.parentIp}</div> : null}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{r.simLabel}</td>
                    <td className={td}>
                      <Copyable value={r.simNumber} />
                    </td>
                    <td className={td}>
                      <Copyable value={r.simIp} />
                    </td>
                    <td className={td}>
                      <Copyable value={r.simIccid} />
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-slate-500`}>
                      {r.hasPin || r.hasPuk
                        ? [r.hasPin ? "PIN" : null, r.hasPuk ? "PUK" : null].filter(Boolean).join(" · ")
                        : "—"}
                    </td>
                    <td className={`${td} max-w-[14rem] truncate text-slate-600 dark:text-slate-300`} title={r.comment}>
                      {r.comment || "—"}
                    </td>
                    <td className={td}>
                      {r.issues.length === 0 ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                          Ок
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.issues.map((issue) => (
                            <span key={issue} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${issueClass(issue)}`}>
                              {SIM_ISSUE_LABEL[issue]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {shownGaps.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20">
          <h2 className="border-b border-amber-200/70 px-3 py-2 text-sm font-semibold text-amber-950 dark:border-amber-900/50 dark:text-amber-100">
            GSM / телефонис без SIM
            <span className="ml-2 text-xs font-medium text-amber-800/80 dark:text-amber-300/80">{shownGaps.length}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>Объект УСПД</th>
                  <th className={th}>Раздел</th>
                  <th className={th}>Устройство</th>
                  <th className={th}>IP</th>
                  <th className={th}>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {shownGaps.map((g) => (
                  <tr key={g.id} className="hover:bg-white/70 dark:hover:bg-slate-900/40">
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => onOpenSite(g.siteId)}
                        className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                      >
                        {g.siteName}
                      </button>
                    </td>
                    <td className={`${td} text-slate-500`}>{g.section || "—"}</td>
                    <td className={td}>{g.object}</td>
                    <td className={`${td} font-mono text-[13px]`}>{g.ip || "—"}</td>
                    <td className={`${td} text-slate-600 dark:text-slate-300`}>{g.comment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
