import {execFileSync} from 'node:child_process';
import {GitContext} from './types';
export function gitContext(root: string): GitContext {
  const run = (args: string[]) => {
    try { return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, maxBuffer: 4096, env: {...process.env, GIT_OPTIONAL_LOCKS: '0'}}).trim() || null; }
    catch { return null; }
  };
  return {head: run(['rev-parse', '--verify', 'HEAD']), branch: run(['symbolic-ref', '--quiet', '--short', 'HEAD'])};
}
