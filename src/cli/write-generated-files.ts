import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GeneratedGlyphPbfFile } from '../index.js';

export interface WriteOptions {
  force: boolean;
}

export async function writeGeneratedFiles(
  files: GeneratedGlyphPbfFile[],
  outputDirectory: string,
  { force }: WriteOptions,
): Promise<void> {
  const destinations = files.map((file) => ({
    bytes: file.bytes,
    path: join(outputDirectory, file.filename),
  }));

  if (!force) {
    const existing = await findExisting(destinations.map((destination) => destination.path));

    if (existing.length > 0) {
      throw new Error(
        `Refusing to overwrite ${existing.length} existing file(s). Pass --force to overwrite:\n` +
          existing.map((path) => `  ${path}`).join('\n'),
      );
    }
  }

  for (const destination of destinations) {
    await mkdir(dirname(destination.path), { recursive: true });
    await writeFile(destination.path, destination.bytes);
  }
}

async function findExisting(paths: string[]): Promise<string[]> {
  const checks = await Promise.all(
    paths.map(async (path) => {
      try {
        await access(path);
        return path;
      } catch {
        return undefined;
      }
    }),
  );

  return checks.filter((path): path is string => path !== undefined);
}
