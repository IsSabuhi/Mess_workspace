/** CSV в UTF-8 с BOM — иначе Excel на Windows открывает кириллицу «кракозябрами». */
export function downloadCsv(filename: string, csv: string): void {
  const withBom = csv.charCodeAt(0) === 0xfeff ? csv : `\uFEFF${csv}`;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
