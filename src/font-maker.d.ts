/**
 * Ambient type declarations for the vendored MapLibre `font-maker` Emscripten
 * module. See `maplibre-font-maker/README.md` for where the runtime comes from.
 *
 * This file has no imports/exports on purpose: the declarations are global, so
 * the WASM glue code can reference them without an import that would dangle in
 * the published `dist/` (hand-written `.d.ts` inputs are not emitted by tsc).
 */

type Pointer = number;

type CcallReturnType = 'number' | 'string' | null;

type CcallArgumentType = 'number' | 'string';

interface FontMakerModule {
  HEAPU8: Uint8Array;
  wasmBinary?: ArrayBuffer | Uint8Array;
  onRuntimeInitialized?: () => void;
  onAbort?: (reason: unknown) => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  ccall(
    ident: string,
    returnType: CcallReturnType,
    argTypes: CcallArgumentType[],
    args: Array<number | string>,
  ): number | string | null;
  _malloc(size: number): number;
  _free(ptr: number): void;
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
}
