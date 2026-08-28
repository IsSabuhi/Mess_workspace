import type { UspdEntryOut, UspdSiteOut } from "../api/uspd";

export function isGsmRow(object: string): boolean {
  return /^gsm$/i.test(object.trim());
}

export function isPhoneLike(object: string): boolean {
  return /gsm|телефон|телеофис|телефонис/i.test(object);
}

export function isSimRow(row: UspdEntryOut): boolean {
  if (!row.parent_id) return false;
  if (/^sim(\s+\d+)?$/i.test(row.object.trim())) return true;
  return !!(row.sim_number || row.sim_ip || row.sim_iccid || row.sim_pin || row.sim_puk);
}

export type SimIssue = "no_number" | "no_ip" | "no_iccid" | "dup_number" | "dup_ip" | "dup_iccid";

export const SIM_ISSUE_LABEL: Record<SimIssue, string> = {
  no_number: "Нет номера",
  no_ip: "Нет IP",
  no_iccid: "Нет ICCID",
  dup_number: "Дубль номера",
  dup_ip: "Дубль IP",
  dup_iccid: "Дубль ICCID",
};

export type SimReportRow = {
  id: string;
  siteId: string;
  siteName: string;
  section: string;
  parentId: string | null;
  parentObject: string;
  parentIp: string;
  simLabel: string;
  simNumber: string;
  simIp: string;
  simIccid: string;
  comment: string;
  hasPin: boolean;
  hasPuk: boolean;
  issues: SimIssue[];
};

export type GsmGapRow = {
  id: string;
  siteId: string;
  siteName: string;
  section: string;
  object: string;
  ip: string;
  comment: string;
};

function t(v: string | null | undefined): string {
  return v?.trim() ?? "";
}

function phoneKey(v: string): string {
  return v.replace(/\D/g, "");
}

function iccidKey(v: string): string {
  return v.replace(/\s+/g, "").toLowerCase();
}

function markDups(rows: SimReportRow[], keyOf: (r: SimReportRow) => string, issue: SimIssue): void {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const r of rows) {
    const k = keyOf(r);
    if (k && (counts.get(k) ?? 0) > 1) r.issues.push(issue);
  }
}

export function collectSimReport(sites: UspdSiteOut[]): { rows: SimReportRow[]; gaps: GsmGapRow[] } {
  const rows: SimReportRow[] = [];
  const gaps: GsmGapRow[] = [];

  for (const site of sites) {
    const byId = new Map(site.entries.map((e) => [e.id, e]));
    for (const e of site.entries) {
      if (!isSimRow(e)) continue;
      const parent = e.parent_id ? byId.get(e.parent_id) : undefined;
      const simNumber = t(e.sim_number);
      const simIp = t(e.sim_ip);
      const simIccid = t(e.sim_iccid);
      const issues: SimIssue[] = [];
      if (!simNumber) issues.push("no_number");
      if (!simIp) issues.push("no_ip");
      if (!simIccid) issues.push("no_iccid");
      rows.push({
        id: e.id,
        siteId: site.id,
        siteName: site.name,
        section: t(parent?.section) || t(e.section),
        parentId: e.parent_id,
        parentObject: t(parent?.object) || "—",
        parentIp: t(parent?.ip),
        simLabel: t(e.object) || "SIM",
        simNumber,
        simIp,
        simIccid,
        comment: t(e.comment),
        hasPin: !!t(e.sim_pin),
        hasPuk: !!t(e.sim_puk),
        issues,
      });
    }
    for (const e of site.entries) {
      if (e.parent_id) continue;
      if (!isGsmRow(e.object) && !isPhoneLike(e.object)) continue;
      const kids = site.entries.filter((x) => x.parent_id === e.id && isSimRow(x));
      if (kids.length > 0) continue;
      gaps.push({
        id: e.id,
        siteId: site.id,
        siteName: site.name,
        section: t(e.section),
        object: t(e.object) || "GSM",
        ip: t(e.ip),
        comment: t(e.comment),
      });
    }
  }

  markDups(rows, (r) => phoneKey(r.simNumber), "dup_number");
  markDups(rows, (r) => t(r.simIp), "dup_ip");
  markDups(rows, (r) => iccidKey(r.simIccid), "dup_iccid");
  rows.sort(
    (a, b) =>
      a.siteName.localeCompare(b.siteName, "ru") ||
      a.parentObject.localeCompare(b.parentObject, "ru") ||
      a.simLabel.localeCompare(b.simLabel, "ru") ||
      a.simNumber.localeCompare(b.simNumber, "ru"),
  );
  gaps.sort((a, b) => a.siteName.localeCompare(b.siteName, "ru") || a.object.localeCompare(b.object, "ru"));
  return { rows, gaps };
}

export function simIsComplete(row: SimReportRow): boolean {
  return !row.issues.some((i) => i === "no_number" || i === "no_ip" || i === "no_iccid");
}

export function simHasDup(row: SimReportRow): boolean {
  return row.issues.some((i) => i.startsWith("dup_"));
}

export function summarizeSimReport(rows: SimReportRow[], gaps: GsmGapRow[]) {
  return {
    total: rows.length,
    withNumber: rows.filter((r) => r.simNumber).length,
    withIp: rows.filter((r) => r.simIp).length,
    withIccid: rows.filter((r) => r.simIccid).length,
    incomplete: rows.filter((r) => !simIsComplete(r)).length,
    dups: rows.filter(simHasDup).length,
    gaps: gaps.length,
  };
}
