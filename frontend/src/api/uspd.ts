import { apiFetch } from "./client";

export type UspdEntryOut = {
  id: string;
  parent_id: string | null;
  object: string;
  model: string | null;
  device_eui: string | null;
  ip: string | null;
  username: string | null;
  password: string;
  comment: string | null;
  section: string | null;
  sim_number: string | null;
  sim_ip: string | null;
  sim_iccid: string | null;
  sim_pin: string;
  sim_puk: string;
  sort_order: number;
};

export type UspdSiteOut = {
  id: string;
  name: string;
  notes: string | null;
  system_id: string | null;
  entries: UspdEntryOut[];
  created_at: string;
  updated_at: string;
};

export type UspdSiteWrite = {
  name: string;
  notes?: string | null;
};

export type UspdEntryWrite = {
  object?: string | null;
  model?: string | null;
  device_eui?: string | null;
  ip?: string | null;
  username?: string | null;
  password?: string | null;
  comment?: string | null;
  section?: string | null;
  parent_id?: string | null;
  sim_number?: string | null;
  sim_ip?: string | null;
  sim_iccid?: string | null;
  sim_pin?: string | null;
  sim_puk?: string | null;
  sort_order?: number;
};

export async function listUspdSites(q = ""): Promise<UspdSiteOut[]> {
  const sp = new URLSearchParams();
  if (q.trim()) sp.set("q", q.trim());
  const qs = sp.toString();
  return apiFetch<UspdSiteOut[]>(`/api/v1/uspd${qs ? `?${qs}` : ""}`);
}

export async function createUspdSite(body: UspdSiteWrite): Promise<UspdSiteOut> {
  return apiFetch<UspdSiteOut>("/api/v1/uspd", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateUspdSite(id: string, body: Partial<UspdSiteWrite>): Promise<UspdSiteOut> {
  return apiFetch<UspdSiteOut>(`/api/v1/uspd/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteUspdSite(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/uspd/${id}`, { method: "DELETE" });
}

export async function uploadUspdImage(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<{ url: string }>("/api/v1/uspd/upload", {
    method: "POST",
    body: fd,
  });
}

export async function createUspdEntry(siteId: string, body: UspdEntryWrite): Promise<UspdEntryOut> {
  return apiFetch<UspdEntryOut>(`/api/v1/uspd/${siteId}/entries`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateUspdEntry(
  siteId: string,
  entryId: string,
  body: UspdEntryWrite,
): Promise<UspdEntryOut> {
  return apiFetch<UspdEntryOut>(`/api/v1/uspd/${siteId}/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteUspdEntry(siteId: string, entryId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/uspd/${siteId}/entries/${entryId}`, { method: "DELETE" });
}

export type UspdHwModelOut = {
  id: string;
  name: string;
  created_at: string;
};

export async function listUspdHwModels(): Promise<UspdHwModelOut[]> {
  return apiFetch<UspdHwModelOut[]>("/api/v1/uspd/models");
}

export async function createUspdHwModel(name: string): Promise<UspdHwModelOut> {
  return apiFetch<UspdHwModelOut>("/api/v1/uspd/models", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export type UspdObsidianFileResult = {
  filename: string;
  site_name: string | null;
  created: boolean;
  skipped: boolean;
  entries: number;
  error: string | null;
};

export type UspdObsidianImportOut = {
  created: number;
  skipped: number;
  failed: number;
  files: UspdObsidianFileResult[];
};

export async function importUspdObsidian(files: File[]): Promise<UspdObsidianImportOut> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  return apiFetch<UspdObsidianImportOut>("/api/v1/uspd/import-obsidian", {
    method: "POST",
    body: form,
  });
}

export type UspdSimExcelRowResult = {
  sheet_row: number;
  phone: string | null;
  ip: string | null;
  site_name: string | null;
  status: string;
  error: string | null;
};

export type UspdSimExcelImportOut = {
  created: number;
  skipped: number;
  unmatched: number;
  empty: number;
  rows: UspdSimExcelRowResult[];
};

export async function importUspdSimExcel(file: File): Promise<UspdSimExcelImportOut> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<UspdSimExcelImportOut>("/api/v1/uspd/import-sim-excel", {
    method: "POST",
    body: form,
  });
}
