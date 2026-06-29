import { instantiateVariableFont, subset } from '@web-alchemy/fonttools';
import { z } from 'zod';

import { nonEmptyString } from './validation.js';

const AXIS_TAG = /^[\x20-\x7e]{4}$/;

// Axis tag/value map with no constraint on tag spelling. Used where tags are
// already trusted, e.g. manifests this tool wrote itself.
export const AxisValuesSchema = z.record(z.string(), z.number().finite());

// Author-facing variation settings: requires 4 printable-ASCII characters per
// axis tag, mirroring the OpenType axis-tag rule.
export const FontVariationSettingsSchema = AxisValuesSchema.superRefine((axes, ctx) => {
  for (const tag of Object.keys(axes)) {
    if (!AXIS_TAG.test(tag)) {
      ctx.addIssue({
        code: 'custom',
        path: [tag],
        message: `Invalid variation axis tag "${tag}". Axis tags must be 4 printable ASCII characters.`,
      });
    }
  }
});

export const FontInputSchema = z.object(
  {
    name: nonEmptyString(),
    // z.instanceof would infer Uint8Array<ArrayBufferLike>; z.custom pins the exact
    // Uint8Array the rest of the codebase passes around.
    bytes: z
      .custom<Uint8Array>((value) => value instanceof Uint8Array, { error: 'must be a Uint8Array' })
      .refine(isSupportedFontInput, {
        error: 'is not a supported TTF, OTF, WOFF, or WOFF2 font',
      }),
    settings: FontVariationSettingsSchema.optional(),
  },
  { error: 'must be an object' },
);

export type FontVariationSettings = z.infer<typeof FontVariationSettingsSchema>;
export type FontInput = z.infer<typeof FontInputSchema>;

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
