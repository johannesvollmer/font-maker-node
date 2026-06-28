import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GeneratedGlyphPbfFile } from '../index.js';

export interface WriteOptions {
  force: boolean;
}

export async function writeGeneratedFiles(
  files: GeneratedGlyphPbfFile[],
  outputDirectory: string,
  fontstack: string,
  { force }: WriteOptions,
): Promise<void> {
  const fontstackDirectory = join(outputDirectory, fontstack);
  const existingEntries = await readDirectoryEntries(fontstackDirectory);

  if (existingEntries.length > 0) {
    if (!force) {
      throw new Error(
        `Refusing to write to non-empty font stack directory: ${fontstackDirectory}. ` +
          'Pass --force to replace its contents.',
      );
    }

    await clearDirectoryEntries(fontstackDirectory, existingEntries);
  }

  for (const file of files) {
    const path = join(outputDirectory, file.filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }
}

async function readDirectoryEntries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function clearDirectoryEntries(directory: string, entries: string[]): Promise<void> {
  await Promise.all(
    entries.map((entry) => rm(join(directory, entry), { recursive: true, force: true })),
  );
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
