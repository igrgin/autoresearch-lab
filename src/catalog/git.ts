import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Finder does not inherit a login shell PATH. Apple Command Line Tools is an
// explicit prerequisite for this internal macOS build, not a bundled Git claim.
export function findGit(): { executable: string; version: string } {
  const executable = '/usr/bin/git';
  if (!existsSync(executable)) throw new Error('Git is unavailable. Install Apple Command Line Tools with xcode-select --install, then retry.');
  try {
    return { executable, version: git(executable, ['--version']).trim() };
  } catch {
    throw new Error('Git could not start. Install or finish setting up Apple Command Line Tools with xcode-select --install, then retry.');
  }
}

export function git(executable: string, args: string[], cwd?: string): string {
  const env = { ...process.env };
  // A coding host's Git worktree/index variables must never redirect project work.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  return execFileSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
