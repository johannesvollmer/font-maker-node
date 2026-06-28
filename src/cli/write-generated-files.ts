import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GeneratedGlyphPbfFile } from '../index.js';

export async function isFontstackDirNonEmpty(fontstackDirectory: string): Promise<boolean> {
  return (await readDirectoryEntries(fontstackDirectory)).length > 0;
}

export async function clearFontstackDir(fontstackDirectory: string): Promise<void> {
  const entries = await readDirectoryEntries(fontstackDirectory);

  await Promise.all(
    entries.map((entry) => rm(join(fontstackDirectory, entry), { recursive: true, force: true })),
  );
}

export async function writeFiles(
  files: GeneratedGlyphPbfFile[],
  outputDirectory: string,
): Promise<void> {
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
