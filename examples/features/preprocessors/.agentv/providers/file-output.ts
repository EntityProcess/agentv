import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputFile = process.argv[2];
if (!outputFile) {
  throw new Error('missing output file path');
}

const generatedDir = path.join(process.cwd(), 'generated');
mkdirSync(generatedDir, { recursive: true });
writeFileSync(path.join(generatedDir, 'report.xlsx'), Buffer.from([0, 159, 146, 150]));

writeFileSync(
  outputFile,
  JSON.stringify({
    output: [
      {
        role: 'assistant',
        content: [
          {
            type: 'file',
            media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            path: 'generated/report.xlsx',
          },
        ],
      },
    ],
  }),
  'utf8',
);
