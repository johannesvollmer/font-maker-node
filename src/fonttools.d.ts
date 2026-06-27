/**
 * Minimal type declarations for the subset of `@web-alchemy/fonttools` we use.
 * The package ships no types of its own.
 */
declare module '@web-alchemy/fonttools' {
  export function instantiateVariableFont(
    inputFontBuffer: Uint8Array,
    options: Record<string, number>,
  ): Promise<Uint8Array>;

  export function subset(
    inputFontBuffer: Uint8Array,
    options: Record<string, string | boolean>,
  ): Promise<Uint8Array>;
}
