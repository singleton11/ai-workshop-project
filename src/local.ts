import { readdir, readFile, readlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AtlasError } from './core/errors.ts';
import type { Source } from './core/scan.ts';

/** Never part of a repository's own files. */
const SKIPPED = new Set(['.git', 'node_modules']);

/** A local checkout as a repository: named after its directory, linked with file:// URLs. */
export async function openDirectory(input: string): Promise<Source> {
  const root = resolve(input);
  const name = basename(root);
  const paths: string[] = [];
  const links: string[] = [];
  try {
    await walk(root, '', paths, links);
  } catch {
    throw new AtlasError(`Not a GitHub URL or a readable directory: ${input}`);
  }
  return {
    repository: { id: name, organization: 'local', name, url: pathToFileURL(root).href, commit: '' },
    paths,
    links,
    warnings: [],
    read: (path) => readFile(join(root, path)).then((bytes) => new Uint8Array(bytes), () => undefined),
    // As the link says it, with `/` between folders, the way Git keeps it.
    readLink: (path) => readlink(join(root, path)).then((target) => target.split(sep).join('/'), () => undefined),
  };
}

/** Every regular file and symbolic link under the directory, as paths relative to the root. */
async function walk(root: string, directory: string, paths: string[], links: string[]): Promise<void> {
  // One list for the whole walk: a large repository has more files than a spread can pass.
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) await walk(root, path, paths, links);
    else if (entry.isFile()) paths.push(path);
    else if (entry.isSymbolicLink()) links.push(path);
  }
}
