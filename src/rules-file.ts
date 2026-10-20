// The rules file on disk, for the Node CLI: spec/rules.md. The core never reads or writes it.
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AtlasError } from './core/errors.ts';
import { DEFAULT_RULES } from './core/rules.ts';
import type { RulesStore } from './commands.ts';

/** `$SKILL_ATLAS_RULES`, else the user's config folder. */
function defaultPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (env.SKILL_ATLAS_RULES) return env.SKILL_ATLAS_RULES;
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'skill-atlas', 'rules.yaml');
  const config = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(config, 'skill-atlas', 'rules.yaml');
}

export function rulesFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): RulesStore {
  return {
    async load(explicit, note) {
      if (explicit) {
        const text = await read(explicit);
        if (text === undefined) throw new AtlasError(`No rules file: ${explicit}`);
        return { path: explicit, text };
      }
      const path = defaultPath(env, platform);
      const existing = await read(path);
      if (existing !== undefined) return { path, text: existing };
      try {
        if (await create(path)) note(`created ${path} with the default rules; edit it to change what is a skill`);
        return { path, text: (await read(path)) ?? DEFAULT_RULES };
      } catch (error) {
        note(`warning: cannot write the rules to ${path} (${error instanceof Error ? error.message : String(error)}); using the defaults`);
        return { path, text: DEFAULT_RULES };
      }
    },
    async peek() {
      const path = defaultPath(env, platform);
      return { path, text: await read(path) };
    },
  };
}

async function read(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new AtlasError(`Cannot read the rules file ${path}: ${(error as Error).message}`);
  }
}

/**
 * Written all at once, and never over an existing file: a hard link only succeeds where there is
 * nothing yet. False if another scan created it first.
 */
async function create(path: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, DEFAULT_RULES, { flag: 'wx' });
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
