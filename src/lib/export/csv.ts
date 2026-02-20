function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  const str = String(value);
  const mustQuote = /[",\n\r]/.test(str);

  if (!mustQuote) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function objectsToCsv(rows: Record<string, any>[]): string {
  if (!rows || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const headerLine = headers.map((key) => escapeCsvValue(key)).join(",");

  const lines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header])).join(",")
  );

  return [headerLine, ...lines].join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function downloadCsv(filename: string, rows: Record<string, any>[]): void {
  const csv = objectsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
