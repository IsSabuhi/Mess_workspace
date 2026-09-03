import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArchive, FileSpreadsheet, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { importEmployeeVacationsExcel } from "../../api/employeeDirectory";
import { importKnowledgeObsidian, listKnowledgeSpaces } from "../../api/knowledge";
import { importUspdObsidian, importUspdSimExcel } from "../../api/uspd";
import { NeedPermission, toastInsufficientRights } from "../../components/NeedPermission";
import { invalidateAndRefetch } from "../../lib/queryClient";
import { toastApiError, toastError, toastSuccess } from "../../lib/toast";
import { useToastQueryError } from "../../lib/useToastQueryError";

export function UspdObsidianImportSection({ allowed }: { allowed: boolean }) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const importMut = useMutation({
    mutationFn: (picked: File[]) => importUspdObsidian(picked),
    onSuccess: async (result) => {
      await invalidateAndRefetch(qc, ["uspd"]);
      const parts = [
        result.created ? `создано ${result.created}` : null,
        result.skipped ? `пропущено ${result.skipped}` : null,
        result.failed ? `ошибок ${result.failed}` : null,
      ].filter(Boolean);
      toastSuccess(parts.length ? `Импорт: ${parts.join(", ")}` : "Импорт завершён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать"),
  });

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт УСПД из Obsidian</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Имя файла — название объекта. Берётся первая таблица Object / Ip / Cred / Comment. Device EUI у БС подтягивается из ссылок {" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">[GW](url) - eui</code>. Если объект с таким именем уже есть — файл пропускается.
      </p>
      <form
        className="mt-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowed) {
            toastInsufficientRights();
            return;
          }
          if (!files.length) {
            toastError("Выберите один или несколько .md");
            return;
          }
          importMut.mutate(files);
        }}
      >
        <input
          type="file"
          accept=".md,.markdown,.txt,text/markdown"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          disabled={importMut.isPending}
          className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <NeedPermission allowed={allowed}>
          <button
            type="submit"
            disabled={importMut.isPending || files.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
          >
          {importMut.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Импорт…
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" aria-hidden />
              Импортировать
            </>
          )}
        </button>
        </NeedPermission>
      </form>
      {files.length > 0 && !importMut.data && (
        <p className="mt-2 text-xs text-slate-500">Выбрано файлов: {files.length}</p>
      )}
      {importMut.data && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-3 font-medium">Файл</th>
                <th className="py-1 pr-3 font-medium">Объект</th>
                <th className="py-1 pr-3 font-medium">Результат</th>
              </tr>
            </thead>
            <tbody>
              {importMut.data.files.map((row) => (
                <tr key={row.filename} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 font-mono">{row.filename}</td>
                  <td className="py-1.5 pr-3">{row.site_name || "—"}</td>
                  <td className="py-1.5 pr-3">
                    {row.created && `создан, строк ${row.entries}`}
                    {row.skipped && (row.error || "пропущен")}
                    {!row.created && !row.skipped && (row.error || "ошибка")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function isObsidianImportFile(file: File): boolean {
  const rel = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(
    /\\/g,
    "/",
  );
  const parts = rel.split("/").map((p) => p.toLowerCase());
  if (parts.some((p) => p === ".obsidian" || p === ".trash" || p === ".git" || p === "__macosx")) {
    return false;
  }
  return /\.(md|markdown|txt|png|jpe?g|gif|webp|bmp)$/i.test(file.name);
}

type FolderBatch = { id: string; rootName: string; files: File[] };

function folderBatchFromList(files: File[]): FolderBatch | null {
  const picked = files.filter(isObsidianImportFile);
  if (!picked.length) return null;
  const rel = ((picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath || picked[0].name).replace(
    /\\/g,
    "/",
  );
  const rootName = rel.split("/").filter(Boolean)[0] || "папка";
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rootName,
    files: picked,
  };
}

export function KnowledgeObsidianImportSection({ allowed }: { allowed: boolean }) {
  const qc = useQueryClient();
  const [spaceId, setSpaceId] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [mdFiles, setMdFiles] = useState<File[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [folderBatches, setFolderBatches] = useState<FolderBatch[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const spaceSelectRef = useRef<HTMLSelectElement>(null);
  const [spaceError, setSpaceError] = useState(false);
  const spacesQuery = useQuery({
    queryKey: ["knowledge", "spaces"],
    queryFn: listKnowledgeSpaces,
  });
  useToastQueryError(spacesQuery.error, "Не удалось загрузить пространства базы знаний");
  const editableSpaces = spacesQuery.data ?? [];
  useEffect(() => {
    if (!spaceId && editableSpaces.length === 1) setSpaceId(editableSpaces[0].id);
  }, [editableSpaces, spaceId]);

  const allFiles = useMemo(() => {
    const byPath = new Map<string, File>();
    const add = (file: File) => {
      if (!isObsidianImportFile(file)) return;
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      byPath.set(rel, file);
    };
    mdFiles.forEach(add);
    imageFiles.forEach(add);
    folderBatches.forEach((batch) => batch.files.forEach(add));
    return [...byPath.values()];
  }, [mdFiles, imageFiles, folderBatches]);
  const mdCount = allFiles.filter((f) => /\.(md|markdown|txt)$/i.test(f.name)).length;
  const imageCount = allFiles.filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)).length;

  const importMut = useMutation({
    mutationFn: () => importKnowledgeObsidian(spaceId, archive ? [] : allFiles, archive),
    onSuccess: async (result) => {
      await invalidateAndRefetch(qc, ["knowledge"]);
      const parts = [
        result.created ? `статей ${result.created}` : null,
        result.folders_created ? `папок ${result.folders_created}` : null,
        result.skipped ? `пропущено ${result.skipped}` : null,
        result.failed ? `ошибок ${result.failed}` : null,
        result.images_uploaded ? `картинок ${result.images_uploaded}` : null,
      ].filter(Boolean);
      toastSuccess(parts.length ? `Импорт: ${parts.join(", ")}` : "Импорт завершён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать"),
  });

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт базы знаний из Obsidian</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Лучше загрузить один zip: папки с заметками и папка <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">PNG</code>{" "}
        (png/jpg/gif/webp) вместе. Можно выбрать несколько папок по очереди и импортировать их одним нажатием — дерево
        каждой папки сохранится. Если в пространстве уже есть страница «Главная» или «Оглавление», импорт кладётся туда
        дочерними статьями — родитель остаётся на месте. Папка PNG с картинками не создаётся как раздел. Имя .md — заголовок статьи. Картинки
        уходят в хранилище, ссылки <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">![[файл.png]]</code>{" "}
        подменяются на новые адреса. Выбор тысяч файлов браузером ломается (лимит ~1000), zip этого не касается.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowed) {
            toastInsufficientRights();
            return;
          }
          if (!spaceId) {
            setSpaceError(true);
            toastError("Выберите пространство базы знаний — без него импортировать некуда");
            spaceSelectRef.current?.focus();
            return;
          }
          setSpaceError(false);
          if (archive) {
            importMut.mutate();
            return;
          }
          if (!mdCount) {
            toastError("Добавьте zip, папку или хотя бы один .md");
            return;
          }
          if (allFiles.length > 900) {
            toastError("Слишком много файлов. Запакуйте хранилище (папки с .md + PNG) в zip и загрузите архив.");
            return;
          }
          importMut.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Пространство
          <select
            ref={spaceSelectRef}
            value={spaceId}
            aria-invalid={spaceError}
            onChange={(e) => {
              setSpaceId(e.target.value);
              if (e.target.value) setSpaceError(false);
            }}
            disabled={spacesQuery.isPending || importMut.isPending}
            className={`max-w-lg rounded-xl border bg-white px-3 py-2 text-sm dark:bg-slate-800 ${
              spaceError
                ? "border-rose-400 ring-2 ring-rose-300/70 dark:border-rose-500 dark:ring-rose-700/50"
                : "border-slate-200 dark:border-slate-600"
            }`}
          >
            <option value="">Выберите пространство</option>
            {editableSpaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {spaceError && (
            <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
              Сначала выберите пространство — иначе неясно, куда класть статьи.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Zip хранилища (рекомендуется)
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setArchive(e.target.files?.[0] ?? null)}
            disabled={importMut.isPending}
            className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        {archive && (
          <p className="text-xs text-slate-500">
            Архив: {archive.name} ({Math.max(1, Math.round(archive.size / (1024 * 1024)))} МБ)
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Или заметки .md по отдельности
          <input
            type="file"
            accept=".md,.markdown,.txt,text/markdown"
            multiple
            onChange={(e) => setMdFiles(Array.from(e.target.files ?? []))}
            disabled={importMut.isPending || Boolean(archive)}
            className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Или картинки (папка PNG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.bmp"
            multiple
            onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))}
            disabled={importMut.isPending || Boolean(archive)}
            className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          <span>Или папки целиком (можно несколько, по одной)</span>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              const batch = folderBatchFromList(Array.from(e.target.files ?? []));
              e.target.value = "";
              if (!batch) return;
              setFolderBatches((prev) => [...prev, batch]);
            }}
            disabled={importMut.isPending || Boolean(archive)}
            className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          {folderBatches.length > 0 && (
            <ul className="mt-1 space-y-1">
              {folderBatches.map((batch) => {
                const notes = batch.files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name)).length;
                const images = batch.files.length - notes;
                return (
                  <li
                    key={batch.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/80"
                  >
                    <span>
                      <span className="font-medium text-slate-800 dark:text-slate-100">{batch.rootName}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {notes} замет.{images ? `, ${images} карт.` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setFolderBatches((prev) => prev.filter((b) => b.id !== batch.id))}
                      disabled={importMut.isPending}
                      className="rounded p-0.5 text-slate-400 hover:text-red-600"
                      title="Убрать папку"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {folderBatches.length > 0 && (
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={importMut.isPending || Boolean(archive)}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить ещё папку
            </button>
          )}
        </div>
        <NeedPermission allowed={allowed}>
        <button
          type="submit"
          disabled={importMut.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
        >
          {importMut.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Импорт…
            </>
          ) : (
            <>
              {archive ? <FileArchive className="h-4 w-4" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
              Импортировать
            </>
          )}
        </button>
        </NeedPermission>
      </form>
      {!archive && (mdCount > 0 || imageCount > 0) && !importMut.data && (
        <p className="mt-2 text-xs text-slate-500">
          К загрузке: {mdCount} заметок, {imageCount} картинок
          {allFiles.length > 900 ? " — слишком много, нужен zip" : ""}
        </p>
      )}
      {editableSpaces.length === 0 && !spacesQuery.isPending && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Нет пространств, куда можно писать. Сначала создайте пространство в базе знаний.
        </p>
      )}
      {importMut.data && (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-2 text-xs text-slate-500">
            Загружено картинок в хранилище: {importMut.data.images_uploaded}
          </p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-3 font-medium">Файл</th>
                <th className="py-1 pr-3 font-medium">Статья</th>
                <th className="py-1 pr-3 font-medium">Результат</th>
              </tr>
            </thead>
            <tbody>
              {importMut.data.files.map((row) => (
                <tr key={row.filename} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 font-mono">{row.filename}</td>
                  <td className="py-1.5 pr-3">{row.title || "—"}</td>
                  <td className="py-1.5 pr-3">
                    {row.created &&
                      `создана${row.images_rewritten ? `, картинок ${row.images_rewritten}` : ""}`}
                    {row.skipped && (row.error || "пропущена")}
                    {!row.created && !row.skipped && (row.error || "ошибка")}
                    {row.missing_images.length > 0 && (
                      <div className="mt-0.5 text-amber-700 dark:text-amber-300">
                        нет файла: {row.missing_images.slice(0, 4).join(", ")}
                        {row.missing_images.length > 4 ? "…" : ""}
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
  );
}

export function UspdSimExcelImportSection({ allowed }: { allowed: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const importMut = useMutation({
    mutationFn: (picked: File) => importUspdSimExcel(picked),
    onSuccess: async (result) => {
      await invalidateAndRefetch(qc, ["uspd"]);
      const parts = [
        result.created ? `добавлено ${result.created}` : null,
        result.skipped ? `уже были ${result.skipped}` : null,
        result.unmatched ? `без GSM ${result.unmatched}` : null,
      ].filter(Boolean);
      toastSuccess(parts.length ? `SIM: ${parts.join(", ")}` : "Импорт SIM завершён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать SIM"),
  });

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт SIM к GSM из Excel</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Первый лист, 1-я строка — заголовки. Колонки: <strong>H</strong> номер телефона, <strong>K</strong> номер
        SIM (ICCID), <strong>Q</strong> IP, <strong>R</strong> адрес установки (в Comment). IP из Q сопоставляется с
        IP в строке GSM (подойдёт и <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">https://217.8.2.1</code>
        ). Если такая SIM уже есть — строка пропускается.
      </p>
      <form
        className="mt-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowed) {
            toastInsufficientRights();
            return;
          }
          if (!file) {
            toastError("Выберите файл .xlsx");
            return;
          }
          importMut.mutate(file);
        }}
      >
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={importMut.isPending}
          className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <NeedPermission allowed={allowed}>
        <button
          type="submit"
          disabled={importMut.isPending || !file}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
        >
          {importMut.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Импорт…
            </>
          ) : (
            <>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Импортировать SIM
            </>
          )}
        </button>
        </NeedPermission>
      </form>
      {importMut.data && (
        <div className="mt-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Добавлено {importMut.data.created}, уже были {importMut.data.skipped}, без GSM {importMut.data.unmatched}
            {importMut.data.empty ? `, без IP ${importMut.data.empty}` : ""}.
          </p>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 pr-3 font-medium">Строка</th>
                  <th className="py-1 pr-3 font-medium">Телефон</th>
                  <th className="py-1 pr-3 font-medium">IP</th>
                  <th className="py-1 pr-3 font-medium">Объект</th>
                  <th className="py-1 pr-3 font-medium">Результат</th>
                </tr>
              </thead>
              <tbody>
                {importMut.data.rows.map((row) => (
                  <tr key={row.sheet_row} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 tabular-nums">{row.sheet_row}</td>
                    <td className="py-1.5 pr-3 font-mono">{row.phone || "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">{row.ip || "—"}</td>
                    <td className="py-1.5 pr-3">{row.site_name || "—"}</td>
                    <td className="py-1.5 pr-3">
                      {row.status === "created" && "добавлена"}
                      {row.status === "skipped" && (row.error || "пропущена")}
                      {row.status === "unmatched" && (row.error || "нет GSM")}
                      {row.status === "empty" && (row.error || "нет IP")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function vacationImportStatusLabel(status: string, error: string | null): string {
  if (status === "created") return "добавлен";
  if (status === "updated") return "обновлён";
  if (status === "skipped") return "уже был";
  if (status === "unmatched") return error || "не найден";
  if (status === "invalid") return error || "ошибка";
  return status;
}

export function VacationExcelImportSection({ allowed }: { allowed: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const importMut = useMutation({
    mutationFn: (picked: File) => importEmployeeVacationsExcel(picked),
    onSuccess: async (result) => {
      await invalidateAndRefetch(qc, ["employee-directory"]);
      const parts = [
        result.created ? `добавлено ${result.created}` : null,
        result.updated ? `обновлено ${result.updated}` : null,
        result.skipped ? `без изменений ${result.skipped}` : null,
        result.unmatched ? `не найдено ${result.unmatched}` : null,
        result.invalid ? `ошибок ${result.invalid}` : null,
      ].filter(Boolean);
      toastSuccess(parts.length ? `Отпуска: ${parts.join(", ")}` : "Импорт отпусков завершён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать отпуска"),
  });

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт отпусков из Excel</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        График отпусков (форма Т-7 или похожий .xlsx / .xlsm). Берутся ФИО, табельный номер, даты начала и окончания.
        Сопоставление: сначала табельный, иначе ФИО. Новые периоды добавляются, совпадение по дате начала — обновляет
        окончание. Больничные и уже введённые отпуска с другими датами не удаляются.
      </p>
      <form
        className="mt-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowed) {
            toastInsufficientRights();
            return;
          }
          if (!file) {
            toastError("Выберите файл .xlsx или .xlsm");
            return;
          }
          importMut.mutate(file);
        }}
      >
        <input
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={importMut.isPending}
          className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <NeedPermission allowed={allowed}>
        <button
          type="submit"
          disabled={importMut.isPending || !file}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
        >
          {importMut.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Импорт…
            </>
          ) : (
            <>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Импортировать отпуска
            </>
          )}
        </button>
        </NeedPermission>
      </form>
      {importMut.data && (
        <div className="mt-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Добавлено {importMut.data.created}, обновлено {importMut.data.updated}, без изменений{" "}
            {importMut.data.skipped}, не найдено {importMut.data.unmatched}
            {importMut.data.invalid ? `, ошибок ${importMut.data.invalid}` : ""}.
          </p>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 pr-3 font-medium">Строка</th>
                  <th className="py-1 pr-3 font-medium">ФИО в файле</th>
                  <th className="py-1 pr-3 font-medium">Сотрудник</th>
                  <th className="py-1 pr-3 font-medium">Период</th>
                  <th className="py-1 pr-3 font-medium">Результат</th>
                </tr>
              </thead>
              <tbody>
                {importMut.data.rows.map((row) => (
                  <tr key={row.sheet_row} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 tabular-nums">{row.sheet_row}</td>
                    <td className="py-1.5 pr-3">{row.full_name || "—"}</td>
                    <td className="py-1.5 pr-3">{row.employee_name || "—"}</td>
                    <td className="py-1.5 pr-3 font-mono">
                      {row.start && row.end ? `${row.start} — ${row.end}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3">{vacationImportStatusLabel(row.status, row.error)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
