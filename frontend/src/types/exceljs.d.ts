/**
 * exceljs 4.4.0 declares index.d.ts in package.json, but the published
 * browser package currently omits that file. Keep a narrow compatibility
 * declaration until the upstream package is fixed or @types/exceljs is
 * available in the build environment.
 */
declare namespace ExcelJS {
  type Fill = any;
  type Font = any;
  type Row = any;
  type Worksheet = any;
  type Workbook = any;
}

declare const ExcelJS: {
  Workbook: new () => ExcelJS.Workbook;
};

declare module "exceljs" {
  export default ExcelJS;
}
