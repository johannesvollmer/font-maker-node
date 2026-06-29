import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { FontVariationSettingsSchema } from './font-normalization.js';
import { generateGlyphPbfFiles } from './generate-glyph-pbf-files.js';
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
import { nonEmptyString, parse } from './validation.js';
import { clearFontstackDir, isFontstackDirNonEmpty, writeFiles } from './write-generated-files.js';

import type { ManifestInputs } from './manifest.js';

const DEFAULT_RANGES = 'latin';

const RangesPresetSchema = z
  .string({ error: `must be one of: ${RANGE_PRESETS.join(', ')}.` })
  .refine((value) => RANGE_PRESETS.includes(value), {
    error: `must be one of: ${RANGE_PRESETS.join(', ')}.`,
  })
  .default(DEFAULT_RANGES);

const FontstackSpecSchema = z.object(
  {
    font: nonEmptyString(),
    fontstack: nonEmptyString(),
    ranges: RangesPresetSchema,
    axes: FontVariationSettingsSchema.default({}),
  },
  { error: 'must be an object' },
);

const BuildFontsOptionsSchema = z.object(
  {
    output: nonEmptyString(),
    fontstacks: z
      .array(FontstackSpecSchema, { error: 'must be a non-empty array' })
      .min(1, { error: 'must be a non-empty array' })
      .superRefine((fontstacks, ctx) => {
        const seen = new Set<string>();

        fontstacks.forEach((entry, index) => {
          if (seen.has(entry.fontstack)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'fontstack'],
              message: `Duplicate fontstack name "${entry.fontstack}". Each fontstack must be unique.`,
            });
          }

          seen.add(entry.fontstack);
        });
      }),
  },
  { error: 'buildFonts requires an options object.' },
);

/** A single font stack to build. `ranges` defaults to `latin`; `axes` to none. */
export type FontstackSpec = z.input<typeof FontstackSpecSchema>;
/** Options for {@link buildFonts}: a shared `output` dir and the stacks to build. */
export type BuildFontsOptions = z.input<typeof BuildFontsOptionsSchema>;

type NormalizedFontstack = z.infer<typeof FontstackSpecSchema>;

export interface FontstackResult {
  fontstack: string;
  status: 'generated' | 'skipped';
  fileCount: number;
}

export async function buildFonts(options: BuildFontsOptions): Promise<FontstackResult[]> {
  const { output, fontstacks } = parse(BuildFontsOptionsSchema, options);
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
