import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generateGlyphPbfFiles } from './generate-glyph-pbf-files.js';
import { validateFontVariationSettings } from './font-normalization.js';
import {
  buildManifest,
  hasManifest,
  isUpToDate,
  readManifest,
  sha256,
  writeManifest,
} from './manifest.js';
import { printGenerated, printRunSummary, printUpToDate } from './print-summary.js';
import { RANGE_PRESETS, resolveRanges } from './resolve-ranges.js';
import { clearFontstackDir, isFontstackDirNonEmpty, writeFiles } from './write-generated-files.js';

import type { FontVariationSettings } from './index.js';
import type { ManifestInputs } from './manifest.js';

const DEFAULT_RANGES = 'latin';

export interface FontstackSpec {
  /** Font file path, resolved relative to the process working directory. */
  font: string;
  /** MapLibre font stack name; also the output subfolder. */
  fontstack: string;
  /** Glyph range preset: basic-latin | latin | all-bmp (default: latin). */
  ranges?: string;
  /** Variable-font axis settings, e.g. { wght: 700 }. */
  axes?: FontVariationSettings;
}

export interface BuildFontsOptions {
  /** Output directory shared by every font stack. */
  output: string;
  fontstacks: FontstackSpec[];
}

export interface FontstackResult {
  fontstack: string;
  status: 'generated' | 'skipped';
  fileCount: number;
}

interface NormalizedFontstack {
  font: string;
  fontstack: string;
  ranges: string;
  axes: FontVariationSettings;
}

export async function buildFonts(options: BuildFontsOptions): Promise<FontstackResult[]> {
  const { output, fontstacks } = validateOptions(options);
  const toolVersion = await readVersion();

  const results: FontstackResult[] = [];
  let generated = 0;
  let skipped = 0;

  for (const entry of fontstacks) {
    const result = await buildFontstack(output, entry, toolVersion);
    results.push(result);

    if (result.status === 'generated') {
      generated += 1;
    } else {
      skipped += 1;
    }
  }

  printRunSummary(generated, skipped);
  return results;
}

async function buildFontstack(
  output: string,
  entry: NormalizedFontstack,
  toolVersion: string,
): Promise<FontstackResult> {
  const fontBytes = await readFontFile(entry.font);
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
    return {
      fontstack: entry.fontstack,
      status: 'skipped',
      fileCount: Object.keys(manifest.files).length,
    };
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
  return { fontstack: entry.fontstack, status: 'generated', fileCount: files.length };
}

function validateOptions(options: BuildFontsOptions): {
  output: string;
  fontstacks: NormalizedFontstack[];
} {
  if (!options || typeof options !== 'object') {
    throw new TypeError('buildFonts requires an options object.');
  }

  const output = requireString(options.output, 'output');
  const fontstacks = requireArray(options.fontstacks, 'fontstacks').map((entry, index) =>
    normalizeFontstack(entry, index),
  );

  assertUniqueFontstacks(fontstacks);

  return { output, fontstacks };
}

function normalizeFontstack(entry: unknown, index: number): NormalizedFontstack {
  const where = `fontstacks[${index}]`;

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`${where} must be an object.`);
  }

  const candidate = entry as Record<string, unknown>;
  const font = requireString(candidate.font, `${where}.font`);
  const fontstack = requireString(candidate.fontstack, `${where}.fontstack`);
  const ranges = resolveRangesPreset(candidate.ranges, `${where}.ranges`);
  const axes = validateFontVariationSettings(
    candidate.axes as FontVariationSettings | undefined,
    `${where}.axes`,
  );

  return { font, fontstack, ranges, axes: axes ?? {} };
}

function resolveRangesPreset(value: unknown, path: string): string {
  if (value === undefined || value === null) {
    return DEFAULT_RANGES;
  }

  if (typeof value !== 'string' || !RANGE_PRESETS.includes(value)) {
    throw new Error(`${path} must be one of: ${RANGE_PRESETS.join(', ')}.`);
  }

  return value;
}

function assertUniqueFontstacks(fontstacks: NormalizedFontstack[]): void {
  const seen = new Set<string>();

  for (const { fontstack } of fontstacks) {
    if (seen.has(fontstack)) {
      throw new Error(`Duplicate fontstack name "${fontstack}". Each fontstack must be unique.`);
    }

    seen.add(fontstack);
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }

  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array.`);
  }

  return value;
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
