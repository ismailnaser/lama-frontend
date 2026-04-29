import ExcelJS from "exceljs";

type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
};

type ExportExcelParams = {
  sheetName: string;
  title: string;
  subtitle?: string;
  columns: ExcelColumn[];
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
  filename: string;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportStyledExcel({
  sheetName,
  title,
  subtitle,
  columns,
  rows,
  filename,
}: ExportExcelParams) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  const titleRow = sheet.addRow([title]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, Math.max(columns.length, 1));
  titleRow.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleRow.alignment = { vertical: "middle", horizontal: "left" };
  titleRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E40AF" },
  };
  titleRow.height = 24;

  if (subtitle) {
    const subtitleRow = sheet.addRow([subtitle]);
    sheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, Math.max(columns.length, 1));
    subtitleRow.font = { size: 11, color: { argb: "FF111827" } };
    subtitleRow.alignment = { vertical: "middle", horizontal: "left" };
    subtitleRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };
    subtitleRow.height = 20;
  }

  sheet.addRow([]);
  const headerRow = sheet.addRow(columns.map((col) => col.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F766E" },
  };
  headerRow.height = 20;

  const dataStartRow = headerRow.number + 1;
  for (const row of rows) {
    const values = columns.map((col) => {
      const raw = row[col.key];
      if (raw === null || raw === undefined) return "";
      if (typeof raw === "boolean") return raw ? "Yes" : "No";
      return raw;
    });
    sheet.addRow(values);
  }

  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width ?? 18;
  });

  for (let r = dataStartRow; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    if ((r - dataStartRow) % 2 === 1) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" },
      };
    }
  }

  sheet.views = [{ state: "frozen", ySplit: dataStartRow - 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
