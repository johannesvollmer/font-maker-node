export function allocateBytes(module: FontMakerModule, bytes: Uint8Array): Pointer {
  const ptr = module._malloc(bytes.byteLength);

  if (!ptr) {
    throw new Error(`Failed to allocate ${bytes.byteLength} bytes in font-maker WASM memory.`);
  }

  new Uint8Array(module.HEAPU8.buffer, ptr, bytes.byteLength).set(bytes);
  return ptr;
}

export function copyBytes(module: FontMakerModule, ptr: Pointer, byteLength: number): Uint8Array {
  if (!ptr) {
    throw new Error('Cannot copy bytes from a null WASM pointer.');
  }

  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new Error(`Invalid WASM byte length: ${byteLength}.`);
  }

  return new Uint8Array(module.HEAPU8.subarray(ptr, ptr + byteLength));
}

export function freePointer(module: FontMakerModule, ptr: Pointer | undefined): void {
  if (ptr) {
    module._free(ptr);
  }
}
