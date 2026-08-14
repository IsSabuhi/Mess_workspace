import ExcelJS from "exceljs";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0EA5E9" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};
const EXAMPLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF9C3" },
};

const COLUMNS = [
  {
    header: "УчетнаяЗапись",
    width: 22,
    note: "Обязательно. Логин без домена, например ivanov.ii. Email станет ivanov.ii@nornik.ru, пароль при создании — тот же логин.",
  },
  {
    header: "ФИО",
    width: 32,
    note: "Обязательно. Полное имя сотрудника.",
  },
  {
    header: "Должность",
    width: 28,
    note: "Обязательная колонка. Название должно совпадать со справочником должностей. Если должности нет в справочнике, она сохранится как текст без привязки.",
  },
  {
    header: "Подразделение",
    width: 24,
    note: "Необязательно. Можно оставить пустым.",
  },
  {
    header: "Системы",
    width: 36,
    note: "Необязательно. Несколько систем через запятую или точку с запятой, например: СМЗиС, АСУТП. Неизвестные системы создаются автоматически.",
  },
] as const;

function triggerDownload(buf: ArrayBuffer, filename: string): void {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadEmployeeImportTemplate(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = "Портал MES";

  const ws = wb.addWorksheet("Сотрудники", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.addRow(COLUMNS.map((c) => c.header));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell: any, col: number) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    const note = COLUMNS[col - 1]?.note;
    if (note) {
      cell.note = note;
    }
  });

  const example = ws.addRow(["IsrafilovSM", "Исрафилов Сабухи Мадад оглы", "Главный специалист", "Отдел поддержки MES-систем", "СМЗиС(ЗФ и НТЭК), АСТО"]);
  example.eachCell((cell: any) => {
    cell.fill = EXAMPLE_FILL;
    cell.font = { italic: true, color: { argb: "FF854D0E" } };
  });
  ws.addRow(["", "", "", "", ""]);
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  const info = wb.addWorksheet("Инструкция");
  info.getColumn(1).width = 92;
  const lines = [
    "Как заполнить шаблон для импорта сотрудников",
    "",
    "1. Заполняйте лист «Сотрудники». Читается первый лист файла.",
    "2. Не переименовывайте заголовки в первой строке. Допустимы синонимы: Логин, Ф.И.О., Позиция, Система.",
    "3. Жёлтая строка — пример. Перед загрузкой замените её своими данными или удалите.",
    "4. Обязательны колонки «УчетнаяЗапись», «ФИО» и «Должность». «Подразделение» и «Системы» можно оставить пустыми.",
    "5. УчетнаяЗапись — логин без домена. В системе создаётся email логин@nornik.ru. Пароль нового сотрудника совпадает с логином, при первом входе его нужно сменить.",
    "6. Должность лучше указывать как в справочнике должностей портала. Иначе сотрудник загрузится, но должность не привяжется.",
    "7. Несколько систем в одной ячейке разделяйте запятой или точкой с запятой: СМЗиС, АСУТП.",
    "8. Если сотрудник с таким логином уже есть, обновятся ФИО, должность и системы.",
    "9. Пустые строки пропускаются. Файл должен быть .xlsx, не больше 10 МБ.",
  ];
  lines.forEach((text, idx) => {
    const row = info.addRow([text]);
    if (idx === 0) {
      row.font = { bold: true, size: 13 };
    } else {
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = text ? 28 : 10;
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(buf as ArrayBuffer, "shablon_import_sotrudnikov.xlsx");
}
