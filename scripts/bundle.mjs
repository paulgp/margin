import {build} from 'esbuild';
import {chmod} from 'node:fs/promises';
await build({entryPoints:['packages/vscode/src/extension.ts'], bundle:true, platform:'node', target:'node20', format:'cjs', external:['vscode'], outfile:'packages/vscode/dist/extension.js', sourcemap:true});
await build({entryPoints:['packages/cli/src/main.ts'], bundle:true, platform:'node', target:'node22', format:'cjs', outfile:'packages/cli/dist/main.js', sourcemap:true});
await chmod('packages/cli/dist/main.js', 0o755);
