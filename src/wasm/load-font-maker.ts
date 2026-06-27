import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

let loadPromise: Promise<FontMakerModule> | undefined;

export async function loadFontMaker(): Promise<FontMakerModule> {
  loadPromise ??= loadFontMakerFresh();
  return loadPromise;
}

async function loadFontMakerFresh(): Promise<FontMakerModule> {
  const vendorDirUrl = new URL('../../maplibre-font-maker/', import.meta.url);
  const glueUrl = new URL('sdfglyph.js', vendorDirUrl);
  const wasmUrl = new URL('sdfglyph.wasm', vendorDirUrl);
  const { WebAssembly } = globalThis as typeof globalThis & { WebAssembly: object };

  const [glueSource, wasmBinary] = await Promise.all([
    readFile(glueUrl, 'utf8'),
    readFile(wasmUrl),
  ]);

  return new Promise<FontMakerModule>((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    const moduleConfig: Partial<FontMakerModule> = {
      wasmBinary,
      print: () => undefined,
      printErr: () => undefined,
      onAbort: (reason) => {
        finish(() => reject(new Error(`font-maker WASM aborted: ${String(reason)}`)));
      },
      onRuntimeInitialized: () => {
        const utf8ToString = context.UTF8ToString;

        if (typeof utf8ToString === 'function') {
          moduleConfig.UTF8ToString = utf8ToString as FontMakerModule['UTF8ToString'];
        }

        if (!isInitializedModule(moduleConfig)) {
          finish(() => reject(new Error('font-maker WASM initialized without the expected API.')));
          return;
        }

        finish(() => resolve(moduleConfig));
      },
    };

    const context = vm.createContext({
      Module: moduleConfig,
      console,
      crypto: globalThis.crypto,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      TextDecoder,
      TextEncoder,
      WebAssembly,
    });

    try {
      const script = new vm.Script(glueSource, {
        filename: fileURLToPath(glueUrl),
      });
      script.runInContext(context);
    } catch (error) {
      finish(() => reject(new Error(`Failed to initialize font-maker WASM: ${formatError(error)}`)));
    }
  });
}

function isInitializedModule(module: Partial<FontMakerModule>): module is FontMakerModule {
  return (
    typeof module.ccall === 'function' &&
    typeof module._malloc === 'function' &&
    typeof module._free === 'function' &&
    typeof module.UTF8ToString === 'function' &&
    isUint8ArrayLike(module.HEAPU8)
  );
}

// The HEAPU8 typed array is created inside the vm sandbox, so it is not an
// `instanceof` the host realm's Uint8Array. Duck-type it instead.
function isUint8ArrayLike(value: Uint8Array | undefined): value is Uint8Array {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buffer' in value &&
    'byteLength' in value &&
    'BYTES_PER_ELEMENT' in value &&
    value.BYTES_PER_ELEMENT === 1
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
