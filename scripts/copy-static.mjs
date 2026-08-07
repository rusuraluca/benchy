import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'src', 'frontend');
const outDir = join(root, 'dist', 'frontend');

if (!existsSync(srcDir)) {
  throw new Error(`frontend sources not found at ${srcDir}`);
}
mkdirSync(outDir, { recursive: true });
cpSync(srcDir, outDir, { recursive: true });
console.log(`[copy-static] ${srcDir} -> ${outDir}`);
