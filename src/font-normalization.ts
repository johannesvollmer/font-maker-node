import { instantiateVariableFont, subset } from '@web-alchemy/fonttools';

export type FontVariationSettings = Record<string, number>;

export interface FontInput {
  name: string;
  bytes: Uint8Array;
  settings?: FontVariationSettings;
}

const WOFF_SIGNATURE = 'wOFF';
const WOFF2_SIGNATURE = 'wOF2';

export function isSupportedFontInput(bytes: Uint8Array): boolean {
  return hasSupportedSfntSignature(bytes) || isWoff(bytes) || isWoff2(bytes);
}

export async function normalizeFontInput(font: FontInput): Promise<FontInput> {
  if (!needsNormalization(font)) {
    return font;
  }

  const bytes = await normalizeWithFontTools(font.bytes, font.settings ?? {});

  if (!hasSupportedSfntSignature(bytes)) {
    throw new Error(`Failed to normalize font "${font.name}": normalized bytes are not a supported TTF or OTF font.`);
  }

  return {
    ...font,
    bytes,
  };
}

export function validateFontVariationSettings(
  settings: FontVariationSettings | undefined,
  path: string,
): FontVariationSettings | undefined {
  if (settings === undefined) {
    return undefined;
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError(`${path} must be an object mapping 4-character axis tags to numeric values.`);
  }

  const normalized: FontVariationSettings = {};

  for (const [axisTag, value] of Object.entries(settings)) {
    if (!isAxisTag(axisTag)) {
      throw new TypeError(`Invalid variation axis tag "${axisTag}" in ${path}. Axis tags must be 4 printable ASCII characters.`);
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Variation axis "${axisTag}" in ${path} must be a finite number.`);
    }

    normalized[axisTag] = value;
  }

  return normalized;
}

function needsNormalization(font: FontInput): boolean {
  return isWoff(font.bytes) || isWoff2(font.bytes) || font.settings !== undefined;
}

async function normalizeWithFontTools(bytes: Uint8Array, settings: FontVariationSettings): Promise<Uint8Array> {
  let result: Uint8Array = bytes;

  // Pin variable axes to the requested location, collapsing the font to a static
  // instance. fontTools raises if the font is not variable or an axis/value is invalid.
  if (Object.keys(settings).length > 0) {
    result = await instantiateVariableFont(result, settings);
  }

  // Instancing preserves the input flavor and the WASM only accepts plain SFNT, so
  // decompress any WOFF/WOFF2 to TTF/OTF. A wildcard subset retains every glyph.
  if (isWoff(result) || isWoff2(result)) {
    result = await subset(result, { '*': true });
  }

  return new Uint8Array(result);
}

function hasSupportedSfntSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) {
    return false;
  }

  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return true;
  }

  const signature = getSignature(bytes);
  return signature === 'OTTO' || signature === 'true' || signature === 'typ1' || signature === 'ttcf';
}

function isWoff(bytes: Uint8Array): boolean {
  return getSignature(bytes) === WOFF_SIGNATURE;
}

function isWoff2(bytes: Uint8Array): boolean {
  return getSignature(bytes) === WOFF2_SIGNATURE;
}

function getSignature(bytes: Uint8Array): string {
  if (bytes.byteLength < 4) {
    return '';
  }

  return String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
}

function isAxisTag(value: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(value);
}
