import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { AxisValuesSchema } from './font-normalization.js';

import type { FontVariationSettings, GeneratedGlyphPbfFile } from './index.js';

export const MANIFEST_FILENAME = 'fontstack.yaml';

const MANIFEST_TOOL = 'maplibre-font-maker-node';
const MANIFEST_COMMENT = `${MANIFEST_TOOL} manifest - regenerated automatically, do not edit`;

export interface ManifestInputs {
  toolVersion: string;
  fontstack: string;
  ranges: string;
  axes: FontVariationSettings;
  fontSha256: string;
}

export interface Manifest extends ManifestInputs {
  tool: string;
  files: Record<string, string>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildManifest(inputs: ManifestInputs, files: GeneratedGlyphPbfFile[]): Manifest {
  const fileHashes: Record<string, string> = {};

  for (const file of files) {
    fileHashes[basename(file.filename)] = sha256(file.bytes);
  }

  return {
    tool: MANIFEST_TOOL,
    toolVersion: inputs.toolVersion,
    fontstack: inputs.fontstack,
    ranges: inputs.ranges,
    axes: inputs.axes,
    fontSha256: inputs.fontSha256,
    files: fileHashes,
  };
}

// Presence of the manifest file marks the folder as one we created, even if its
// contents are unreadable. Ownership lets us safely regenerate without --force.
export async function hasManifest(fontstackDirectory: string): Promise<boolean> {
  try {
    await access(join(fontstackDirectory, MANIFEST_FILENAME));
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(fontstackDirectory: string): Promise<Manifest | null> {
  let raw: string;

  try {
    raw = await readFile(join(fontstackDirectory, MANIFEST_FILENAME), 'utf8');
  } catch {
    return null;
  }

  try {
    const result = ManifestSchema.safeParse(parseYaml(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function writeManifest(fontstackDirectory: string, manifest: Manifest): Promise<void> {
  const yaml = `# ${MANIFEST_COMMENT}\n${stringifyYaml(manifest)}`;
  await writeFile(join(fontstackDirectory, MANIFEST_FILENAME), yaml);
}

export async function isUpToDate(
  manifest: Manifest,
  inputs: ManifestInputs,
  fontstackDirectory: string,
): Promise<boolean> {
  if (
    manifest.toolVersion !== inputs.toolVersion ||
    manifest.fontstack !== inputs.fontstack ||
    manifest.ranges !== inputs.ranges ||
    manifest.fontSha256 !== inputs.fontSha256 ||
    canonicalAxes(manifest.axes) !== canonicalAxes(inputs.axes)
  ) {
    return false;
  }

  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    let bytes: Buffer;

    try {
      bytes = await readFile(join(fontstackDirectory, filename));
    } catch {
      return false;
    }

    if (sha256(bytes) !== expectedHash) {
      return false;
    }
  }

  return true;
}

// Axis tags in a manifest are not re-checked against the 4-char rule: this tool
// wrote them, and older manifests predate axis support, so a missing or null
// block means "no axes".
const ManifestSchema = z.object({
  tool: z.string(),
  toolVersion: z.string(),
  fontstack: z.string(),
  ranges: z.string(),
  axes: z.preprocess((value) => (value === undefined || value === null ? {} : value), AxisValuesSchema),
  fontSha256: z.string(),
  files: z.record(z.string(), z.string()),
});

// Stable key order so axis maps compare equal regardless of how they were written.
function canonicalAxes(axes: FontVariationSettings): string {
  const sorted = Object.entries(axes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(sorted));
}
