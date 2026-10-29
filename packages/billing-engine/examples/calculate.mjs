import { readFileSync } from 'node:fs';
import { calculateInvoice } from '../dist/index.js';

// Synthetic inputs only. This example never reads credentials or changes records.
const input = JSON.parse(
  readFileSync(new URL('./domestic.json', import.meta.url), 'utf8'),
);
console.log(JSON.stringify(calculateInvoice(input), null, 2));
