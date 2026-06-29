/**
 * Minimal type declarations for the subset of `subset-font` we use.
 * The package ships no types of its own; it wraps HarfBuzz's hb-subset (WASM)
 * and reads/writes WOFF/WOFF2 via fontverter.
 */
declare module 'subset-font' {
  interface SubsetFontOptions {
    /** Output container. 'truetype' is an alias for 'sfnt'. Defaults to 'sfnt'. */
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    /** Pin (or range-narrow) variable-font axes. Only affects variable fonts. */
    variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>;
    /** Extra name-table ids to retain. */
    preserveNameIds?: number[];
    /** Skip glyph closure for layout substitutions. */
    noLayoutClosure?: boolean;
  }

  /** Subsets `font` to the glyphs needed for `text`, returning the encoded font bytes. */
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
