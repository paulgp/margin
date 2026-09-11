import * as fs from 'node:fs';
import * as path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {prepare, importResponse} = require('../packages/core/dist');
const {mockProvider} = require('../packages/cli/dist/providers');
for (const [name, file] of [['markdown','draft.md'], ['typst','draft.typ'], ['latex',null]]) {
  const target = path.resolve('.demo', name);
  fs.mkdirSync(target, {recursive:true});
  fs.cpSync(path.resolve('examples', name), target, {recursive:true, force:false, errorOnExist:false});
  const {request} = prepare(target, file ? {file} : {project:true});
  const result = await mockProvider.run(request);
  const session = importResponse(target, request.id, result.response, result.provenance);
  console.log(`${name}: ${session.id}\n  workspace: ${target}`);
}
console.log('\nOffline demo ready. With Margin installed, open: code --reuse-window .demo/markdown\nThen use Margin: Select Review. For development, press F5 in this repository.\nTo review again from the repository directory: margin review draft.md --root .demo/markdown --provider mock\nExisting demo edits are preserved.');
