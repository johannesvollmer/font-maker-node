#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateGlyphPbfFiles } from './index.js';
import {
  buildManifest,
  hasManifest,
  isUpToDate,
  readManifest,
  sha256,
  writeManifest,
} from './cli/manifest.js';
import { parseCliArgs } from './cli/parse-args.js';
import { printSummary, printUpToDate } from './cli/print-summary.js';
import { resolveRanges } from './cli/resolve-ranges.js';
import {
  clearFontstackDir,
  isFontstackDirNonEmpty,
  writeFiles,
} from './cli/write-generated-files.js';

import type { ManifestInputs } from './cli/manifest.js';
import type { CliOptions } from './cli/parse-args.js';

const HELP_TEXT = `maplibre-font-maker-node

Generate MapLibre glyph PBF files from TTF, OTF, WOFF, or WOFF2 fonts.

Usage:
  maplibre-font-maker-node \\
      --font <file.ttf> \\
      --fontstack "Barlow Regular" \\
      --output ./fonts

Options:
  --font        Input font file (required)
  --fontstack   MapLibre font stack name (required)
  --output      Output directory (required)
  --ranges      Glyph range preset: basic-latin | latin | all-bmp (default: latin)
  --force       Regenerate even if the cached output is already up to date
  --help        Show this help
  --version     Show version

A "fontstack.yaml" manifest is written alongside the generated files. On reruns,
generation is skipped when the font, fontstack, ranges, and tool version are
unchanged and every output file is still intact; it regenerates automatically
when any of those change.
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

  await generate(parsed.options);
}

async function generate(options: CliOptions): Promise<void> {
  const fontBytes = await readFontFile(options.font);
  const ranges = resolveRanges(options.ranges);

  const fontstackDirectory = join(options.output, options.fontstack);
  const inputs: ManifestInputs = {
    toolVersion: await readVersion(),
    fontstack: options.fontstack,
    ranges: options.ranges,
    fontSha256: sha256(fontBytes),
  };

  const manifest = await readManifest(fontstackDirectory);

  if (!options.force && manifest && (await isUpToDate(manifest, inputs, fontstackDirectory))) {
    printUpToDate({ fontstack: options.fontstack, output: options.output });
    return;
  }

  if (
    !options.force &&
    !(await hasManifest(fontstackDirectory)) &&
    (await isFontstackDirNonEmpty(fontstackDirectory))
  ) {
    throw new Error(
      `Refusing to write to non-empty font stack directory: ${fontstackDirectory}. ` +
        'Pass --force to replace its contents.',
    );
  }

  const files = await generateGlyphPbfFiles({
    fontstack: options.fontstack,
    fonts: [{ name: options.fontstack, bytes: fontBytes }],
    ranges,
  });

  await clearFontstackDir(fontstackDirectory);
  await writeFiles(files, options.output);
  await writeManifest(fontstackDirectory, buildManifest(inputs, files));

  printSummary({
    fontstack: options.fontstack,
    fileCount: files.length,
    output: options.output,
  });
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
