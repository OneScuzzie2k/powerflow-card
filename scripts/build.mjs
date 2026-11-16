import { readFile, mkdir, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const files = ['model.js', 'styles.js', 'editor.js', 'card.js'];
const parts = await Promise.all(files.map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));
const bundle = parts.map(source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/powerflow-card.js', import.meta.url), `/* Powerflow Card v${pkg.version} | MIT | https://github.com/OneScuzzie2k/powerflow-card */\n${bundle.replaceAll('__VERSION__', pkg.version)}`);
console.log(`Built dist/powerflow-card.js (${pkg.version}), no runtime dependencies.`);
