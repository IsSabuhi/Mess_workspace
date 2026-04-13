/** Задача в колонке «на согласовании» (эвристика по slug и названию). */
export function taskInApprovalColumn(t: { column: { slug: string; name: string } | null }): boolean {
  const slug = (t.column?.slug ?? "").toLowerCase();
  const name = (t.column?.name ?? "").toLowerCase();
  return (
    slug.includes("approval") ||
    slug.includes("approve") ||
    slug.includes("agreement") ||
    name.includes("соглас")
  );
}
