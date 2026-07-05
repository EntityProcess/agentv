import { existsSync } from 'node:fs';
import path from 'node:path';

type ContentFile = {
  type?: string;
  media_type?: string;
  path?: string;
};

const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function findSpreadsheet(output: unknown): ContentFile | undefined {
  if (!Array.isArray(output)) {
    return undefined;
  }

  return output.find((block): block is ContentFile => {
    if (!block || typeof block !== 'object') {
      return false;
    }
    const file = block as ContentFile;
    return (
      file.type === 'file' &&
      typeof file.path === 'string' &&
      (file.path.endsWith('.xlsx') || file.media_type === XLSX_MEDIA_TYPE)
    );
  });
}

function spreadsheetPath(file: ContentFile): string {
  if (!file.path) {
    throw new Error('missing spreadsheet path');
  }

  if (path.isAbsolute(file.path)) {
    return file.path;
  }

  return path.resolve(import.meta.dir, '..', '..', file.path);
}

export default function transform(output: unknown): string {
  const file = findSpreadsheet(output);
  if (!file) {
    throw new Error('expected a .xlsx ContentFile output');
  }

  const absolutePath = spreadsheetPath(file);
  if (!existsSync(absolutePath)) {
    throw new Error(`spreadsheet not found: ${file.path}`);
  }

  // Example-only placeholder conversion. Replace this with a real XLSX parser
  // such as SheetJS or your project's existing spreadsheet extractor.
  return ['spreadsheet: revenue,total', 'Q1,42'].join('\n');
}

if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('missing file path');
  }
  const payload: ContentFile = {
    type: 'file',
    media_type: XLSX_MEDIA_TYPE,
    path: filePath,
  };
  process.stdout.write(`${transform([payload])}\n`);
}
