import { z } from 'zod';

import { FontInputSchema, normalizeFontInput } from './font-normalization.js';
import { range256 } from './ranges.js';
import { nonEmptyString, parse } from './validation.js';
import { loadFontMaker } from './wasm/load-font-maker.js';
import { allocateBytes, copyBytes, freePointer } from './wasm/memory.js';
import { ccallNumber, ccallVoid } from './wasm/sdfglyph-module.js';

import type { FontInput } from './font-normalization.js';
import type { GlyphRange } from './ranges.js';

export interface GeneratedGlyphPbfFile {
  filename: string;
  bytes: Uint8Array;
}

const FontstackNameSchema = nonEmptyString().refine((value) => !value.includes('\0'), {
  error: 'must not contain null bytes',
});

// Accepts any object with numeric start/end, then canonicalizes it to the aligned
// 256-codepoint range MapLibre expects, verifying the caller's end matches.
const GlyphRangeSchema = z
  .object({ start: z.number(), end: z.number() }, { error: 'must be an object' })
  .superRefine((range, ctx) => {
    let expected: GlyphRange;

    try {
      expected = range256(range.start);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: formatError(error) });
      return;
    }

    if (range.end !== expected.end) {
      ctx.addIssue({
        code: 'custom',
        message: `must be a 256-codepoint range. Expected ${formatRange(expected)}.`,
      });
    }
  })
  .transform((range) => range256(range.start));

const GenerateGlyphPbfFilesOptionsSchema = z.object(
  {
    fontstack: FontstackNameSchema,
    fonts: z
      .array(FontInputSchema, { error: 'must contain at least one font' })
      .min(1, { error: 'must contain at least one font' }),
    ranges: z
      .array(GlyphRangeSchema, { error: 'must contain at least one glyph range' })
      .min(1, { error: 'must contain at least one glyph range' })
      .superRefine((ranges, ctx) => {
        const seen = new Set<string>();

        ranges.forEach((range, index) => {
          const key = formatRange(range);

          if (seen.has(key)) {
            ctx.addIssue({ code: 'custom', path: [index], message: `Duplicate glyph range: ${key}.` });
          }

          seen.add(key);
        });
      }),
  },
  { error: 'must be an object' },
);

export type GenerateGlyphPbfFilesOptions = z.input<typeof GenerateGlyphPbfFilesOptionsSchema>;

export async function generateGlyphPbfFiles(
  options: GenerateGlyphPbfFilesOptions,
): Promise<GeneratedGlyphPbfFile[]> {
  const { fontstack, fonts, ranges } = parse(GenerateGlyphPbfFilesOptionsSchema, options);
  const normalizedFonts = await normalizeFonts(fonts);
  const module = await initializeWasm();

  let fontstackPtr: Pointer | undefined;
  const fontDataPtrs: Pointer[] = [];

  try {
    fontstackPtr = ccallNumber(module, 'create_fontstack', ['string'], [fontstack]);

    if (!fontstackPtr) {
      throw new Error('font-maker WASM returned a null fontstack pointer.');
    }

    for (const font of normalizedFonts) {
      const dataPtr = allocateBytes(module, font.bytes);
      fontDataPtrs.push(dataPtr);
      addFace(module, fontstackPtr, font, dataPtr);
    }

    return ranges.map((range) => generateRange(module, fontstackPtr!, fontstack, range));
  } finally {
    if (fontstackPtr) {
      ccallVoid(module, 'free_fontstack', ['number'], [fontstackPtr]);
    }

    for (const ptr of fontDataPtrs) {
      freePointer(module, ptr);
    }
  }
}

async function initializeWasm(): Promise<FontMakerModule> {
  try {
    return await loadFontMaker();
  } catch (error) {
    throw new Error(`Failed to initialize font-maker WASM: ${formatError(error)}`);
  }
}

function addFace(module: FontMakerModule, fontstackPtr: Pointer, font: FontInput, dataPtr: Pointer): void {
  try {
    ccallVoid(module, 'fontstack_add_face', ['number', 'number', 'number'], [
      fontstackPtr,
      dataPtr,
      font.bytes.byteLength,
    ]);
  } catch (error) {
    throw new Error(`Failed to add font "${font.name}": ${formatError(error)}`);
  }
}

function generateRange(
  module: FontMakerModule,
  fontstackPtr: Pointer,
  fontstack: string,
  range: GlyphRange,
): GeneratedGlyphPbfFile {
  let glyphBufferPtr: Pointer | undefined;

  try {
    glyphBufferPtr = ccallNumber(module, 'generate_glyph_buffer', ['number', 'number'], [
      fontstackPtr,
      range.start,
    ]);

    if (!glyphBufferPtr) {
      throw new Error(`font-maker WASM returned a null glyph buffer pointer for ${formatRange(range)}.`);
    }

    const dataPtr = ccallNumber(module, 'glyph_buffer_data', ['number'], [glyphBufferPtr]);
    const byteLength = ccallNumber(module, 'glyph_buffer_size', ['number'], [glyphBufferPtr]);

    if (byteLength <= 0) {
      throw new Error(`font-maker WASM returned an empty glyph buffer for ${formatRange(range)}.`);
    }

    return {
      filename: `${fontstack}/${formatRange(range)}.pbf`,
      bytes: copyBytes(module, dataPtr, byteLength),
    };
  } catch (error) {
    throw new Error(`Failed to generate glyph range ${formatRange(range)}: ${formatError(error)}`);
  } finally {
    if (glyphBufferPtr) {
      ccallVoid(module, 'free_glyph_buffer', ['number'], [glyphBufferPtr]);
    }
  }
}

async function normalizeFonts(fonts: FontInput[]): Promise<FontInput[]> {
  try {
    return await Promise.all(fonts.map((font) => normalizeFontInput(font)));
  } catch (error) {
    throw new Error(`Failed to normalize font input: ${formatError(error)}`);
  }
}

function formatRange(range: GlyphRange): string {
  return `${range.start}-${range.end}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
