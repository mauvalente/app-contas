// Copia os arquivos do app (pasta acima) para www/, que vai dentro do APK.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const www = join(here, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of ['index.html', 'manifest.webmanifest', 'capacitor.js', 'icons']) {
  cpSync(join(root, f), join(www, f), { recursive: true });
}
console.log('✓ Arquivos do app copiados para www/');
