import { allBmpRanges, basicLatinRanges, latinRanges } from '../index.js';

import type { GlyphRange } from '../index.js';

const PRESETS: Record<string, () => GlyphRange[]> = {
  'basic-latin': basicLatinRanges,
  latin: latinRanges,
  'all-bmp': allBmpRanges,
};

export const RANGE_PRESETS = Object.keys(PRESETS);

export function resolveRanges(preset: string): GlyphRange[] {
  const build = PRESETS[preset];

  if (!build) {
    throw new Error(
      `Invalid --ranges preset "${preset}". Valid presets are: ${RANGE_PRESETS.join(', ')}.`,
    );
  }

  return build();
}
