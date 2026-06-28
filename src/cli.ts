#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateGlyphPbfFiles } from './index.js';
import { loadConfig } from './cli/config.js';
import {
  buildManifest,
  hasManifest,
  isUpToDate,
  readManifest,
  sha256,
  writeManifest,
} from './cli/manifest.js';
import { parseCliArgs } from './cli/parse-args.js';
import { printGenerated, printRunSummary, printUpToDate } from './cli/print-summary.js';
import { resolveRanges } from './cli/resolve-ranges.js';
import {
  clearFontstackDir,
  isFontstackDirNonEmpty,
  writeFiles,
} from './cli/write-generated-files.js';

import type { ResolvedFontstack } from './cli/config.js';
import type { ManifestInputs } from './cli/manifest.js';

const HELP_TEXT = `maplibre-font-maker-node

Generate MapLibre glyph PBF files from TTF, OTF, WOFF, or WOFF2 fonts.

Usage:
  maplibre-font-maker-node <config.yaml>

The config is a YAML file describing a shared output directory and one or more
font stacks to generate:

  output: ./dist/fonts
  fontstacks:
    - font: ./fonts/Inter.woff2
      fontstack: Inter Bold
      ranges: latin          # optional: basic-latin | latin | all-bmp (default: latin)
      axes:                  # optional: variable-font axes (tag -> value)
        wght: 700
    - font: ./fonts/Inter.woff2
      fontstack: Inter Regular
      axes: { wght: 400 }

Relative font and output paths resolve against the config file's directory.

Options:
  --help        Show this help
  --version     Show version

Each font stack folder gets a "fontstack.yaml" manifest. On reruns, generation
is skipped when the font, ranges, axes, and tool version are unchanged and every
output file is still intact, and regenerates automatically when any of those change.
`;

export async function run(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.kind === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  if (parsed.kind === 'version') {
    console.log(await readVersion());
    return;
  }

  await generate(parsed.configPath);
}

async function generate(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const toolVersion = await readVersion();

  let generated = 0;
  let skipped = 0;

  for (const entry of config.fontstacks) {
    if (await generateFontstack(config.output, entry, toolVersion)) {
      generated += 1;
    } else {
      skipped += 1;
    }
  }

  printRunSummary(generated, skipped);
}

// Returns true when files were (re)generated, false when the cache was up to date.
async function generateFontstack(
  output: string,
  entry: ResolvedFontstack,
  toolVersion: string,
): Promise<boolean> {
  const fontBytes = await readFontFile(entry.fontPath);
  const ranges = resolveRanges(entry.ranges);
  const fontstackDirectory = join(output, entry.fontstack);

  const inputs: ManifestInputs = {
    toolVersion,
    fontstack: entry.fontstack,
    ranges: entry.ranges,
    axes: entry.axes,
    fontSha256: sha256(fontBytes),
  };

  const manifest = await readManifest(fontstackDirectory);

  if (manifest && (await isUpToDate(manifest, inputs, fontstackDirectory))) {
    printUpToDate({ fontstack: entry.fontstack, output });
    return false;
  }

  if (!(await hasManifest(fontstackDirectory)) && (await isFontstackDirNonEmpty(fontstackDirectory))) {
    throw new Error(
      `Refusing to write to non-empty font stack directory: ${fontstackDirectory}. ` +
        'Delete it to regenerate.',
    );
  }

  const files = await generateGlyphPbfFiles({
    fontstack: entry.fontstack,
    fonts: [
      {
        name: entry.fontstack,
        bytes: fontBytes,
        settings: Object.keys(entry.axes).length > 0 ? entry.axes : undefined,
      },
    ],
    ranges,
  });

  await clearFontstackDir(fontstackDirectory);
  await writeFiles(files, output);
  await writeManifest(fontstackDirectory, buildManifest(inputs, files));

  printGenerated({ fontstack: entry.fontstack, fileCount: files.length, output });
  return true;
}

async function readFontFile(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error(`Font file not found: ${path}`);
    }

    throw new Error(`Failed to read font file "${path}": ${formatError(error)}`);
  }
}

async function readVersion(): Promise<string> {
  const packageUrl = new URL('../package.json', import.meta.url);
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8')) as { version?: string };
  return manifest.version ?? 'unknown';
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1];

if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
