import xlsx from 'xlsx';
import { createAdapter } from './createAdapter';
import { createRange } from './util';

const cell = (r, c) => xlsx.utils.encode_cell({ r, c });

export interface RunOptions {
  input: string;
  tables: string[];
  prefix: string;
  drop: boolean;
  create: boolean;
  batchSize: number;
}

export async function run(dbConfig: any, options: RunOptions, log: (...args: any[]) => void) {
  log('Connecting to the database');
  const db = await createAdapter(dbConfig);
  log('Database connected');

  try {
    log(`Reading input file '${options.input}'`);
    const wb = xlsx.readFile(options.input);
    for (const sheetName of wb.SheetNames) {
      if (options.tables && options.tables.indexOf(sheetName) === -1) {
        continue;
      }
      const tableName = options.prefix + sheetName;
      log(`Importing sheet '${sheetName}' to table '${tableName}'`);

      if (options.drop) {
        log(`Dropping table ${tableName}`);
        await db.dropTable(tableName);
      }

      const columns = [];
      const ws = wb.Sheets[sheetName];
      const range = xlsx.utils.decode_range(ws['!ref']);
      let nColumns = range.e.c + 1;
      const nRows = range.e.r + 1;
      for (let c = 0; c < nColumns; c++) {
        const wc = ws[cell(0, c)];
        if (!wc || !wc.w) {
          nColumns = c;
          break;
        }
        columns.push(wc.w);
      }

      if (options.drop || options.create) {
        log(`Creating table ${tableName}(${columns.join(',')})`);
        await db.createTable(tableName, columns);
      }

      const nBatches = Math.ceil((nRows - 1) / options.batchSize);
      for (const iBatch of createRange(0, nBatches)) {
        const rows = [];
        const batchStart = iBatch * options.batchSize + 1;
        const batchEnd = Math.min(nRows, (iBatch + 1) * options.batchSize + 1);
        for (let iRow = batchStart; iRow < batchEnd; iRow++) {
          const row = [];
          let hasNonEmpty = false;
          for (let iCol = 0; iCol < nColumns; iCol++) {
            const wc = ws[cell(iRow, iCol)];
            if (wc) {
              hasNonEmpty = true;
            }
            row.push(wc && wc.w || '');
          }
          if (hasNonEmpty) {
            rows.push(row);
          }
        }

        if (rows.length === 0) {
          log(`No non-empty rows in a batch. Breaking`);
          break;
        }

        log(`Inserting batch ${iBatch + 1}/${nBatches} (${rows.length})`);
        await db.insertValues(tableName, columns, rows);
      }
    }
  } finally {
    await db.close();
    log('Database connection closed');
  }
}
