import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { GeneratedGlyphPbfFile } from '../index.js';

export const MANIFEST_FILENAME = 'fontstack.yaml';

const MANIFEST_TOOL = 'maplibre-font-maker-node';
const MANIFEST_COMMENT = `${MANIFEST_TOOL} manifest - regenerated automatically, do not edit`;

export interface ManifestInputs {
  toolVersion: string;
  fontstack: string;
  ranges: string;
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
    return asManifest(parseYaml(raw));
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
    manifest.fontSha256 !== inputs.fontSha256
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

function asManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Manifest is not an object.');
  }

  const candidate = value as Record<string, unknown>;
  const files = candidate.files;

  if (
    typeof candidate.tool !== 'string' ||
    typeof candidate.toolVersion !== 'string' ||
    typeof candidate.fontstack !== 'string' ||
    typeof candidate.ranges !== 'string' ||
    typeof candidate.fontSha256 !== 'string' ||
    !files ||
    typeof files !== 'object'
  ) {
    throw new Error('Manifest is missing required fields.');
  }

  const fileHashes: Record<string, string> = {};

  for (const [name, hash] of Object.entries(files as Record<string, unknown>)) {
    if (typeof hash !== 'string') {
      throw new Error(`Manifest file entry "${name}" is not a string.`);
    }

    fileHashes[name] = hash;
  }

  return {
    tool: candidate.tool,
    toolVersion: candidate.toolVersion,
    fontstack: candidate.fontstack,
    ranges: candidate.ranges,
    fontSha256: candidate.fontSha256,
    files: fileHashes,
  };
}
