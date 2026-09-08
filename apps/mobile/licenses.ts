import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** Keep original license texts alongside the distributed browser bundle. */
export function licenses(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle() {
      const entries = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        if (!id.includes('node_modules') || id.includes('\0')) continue;
        let folder = dirname(id.split('?')[0]!);
        while (folder.includes('node_modules')) {
          const path = join(folder, 'package.json');
          if (existsSync(path)) {
            const meta = JSON.parse(readFileSync(path, 'utf8'));
            if (meta.name) {
              const name = meta.name + '@' + meta.version;
              if (!entries.has(name)) {
                const names = readdirSync(folder).filter(n => /^(license|copying|notice)(\..*)?$/i.test(n));
                if (!names.length) throw new Error('Missing browser dependency license: ' + name);
                entries.set(name, names.map(n => readFileSync(join(folder, n), 'utf8')).join('\n'));
              }
              break;
            }
          }
          folder = dirname(folder);
        }
      }
      if (!entries.size) throw new Error('Browser dependency license scan returned no modules');
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: [...entries].sort().map(([name, text]) => name + '\n' + text).join('\n\n') });
    },
  };
}
