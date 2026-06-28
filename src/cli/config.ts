import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { validateFontVariationSettings } from '../font-normalization.js';
import { RANGE_PRESETS } from './resolve-ranges.js';

import type { FontVariationSettings } from '../index.js';

const DEFAULT_RANGES = 'latin';

export interface ResolvedFontstack {
  fontPath: string;
  fontstack: string;
  ranges: string;
  axes: FontVariationSettings;
}

export interface ResolvedConfig {
  output: string;
  fontstacks: ResolvedFontstack[];
}

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const raw = await readConfigFile(configPath);

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(`Failed to parse config file "${configPath}": ${formatError(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Config file "${configPath}" must contain a YAML mapping at the top level.`);
  }

  const baseDirectory = dirname(resolve(configPath));
  const output = requireString(parsed.output, 'output');
  const fontstacks = requireArray(parsed.fontstacks, 'fontstacks').map((entry, index) =>
    resolveFontstack(entry, index, baseDirectory),
  );

  assertUniqueFontstacks(fontstacks);

  return {
    output: resolve(baseDirectory, output),
    fontstacks,
  };
}

async function readConfigFile(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`);
    }

    throw new Error(`Failed to read config file "${configPath}": ${formatError(error)}`);
  }
}

function resolveFontstack(entry: unknown, index: number, baseDirectory: string): ResolvedFontstack {
  const where = `fontstacks[${index}]`;

  if (!isRecord(entry)) {
    throw new Error(`${where} must be a mapping.`);
  }

  const font = requireString(entry.font, `${where}.font`);
  const fontstack = requireString(entry.fontstack, `${where}.fontstack`);
  const ranges = resolveRangesPreset(entry.ranges, `${where}.ranges`);
  const axes = validateFontVariationSettings(
    entry.axes as FontVariationSettings | undefined,
    `${where}.axes`,
  );

  return {
    fontPath: resolve(baseDirectory, font),
    fontstack,
    ranges,
    axes: axes ?? {},
  };
}

function resolveRangesPreset(value: unknown, path: string): string {
  if (value === undefined || value === null) {
    return DEFAULT_RANGES;
  }

  if (typeof value !== 'string' || !RANGE_PRESETS.includes(value)) {
    throw new Error(
      `${path} must be one of: ${RANGE_PRESETS.join(', ')}.`,
    );
  }

  return value;
}

function assertUniqueFontstacks(fontstacks: ResolvedFontstack[]): void {
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
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
