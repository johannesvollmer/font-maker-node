export interface GlyphRange {
  start: number;
  end: number;
}

const RANGE_SIZE = 256;
const BMP_END = 0xffff;

export function range256(start: number): GlyphRange {
  validateRangeStart(start);
  return { start, end: start + RANGE_SIZE - 1 };
}

export function basicLatinRanges(): GlyphRange[] {
  return [range256(0)];
}

export function latinRanges(): GlyphRange[] {
  return [range256(0), range256(256), range256(512)];
}

export function allBmpRanges(): GlyphRange[] {
  return Array.from({ length: (BMP_END + 1) / RANGE_SIZE }, (_, index) => range256(index * RANGE_SIZE));
}

function validateRangeStart(start: number): void {
  if (!Number.isInteger(start)) {
    throw new RangeError(`Range start must be an integer. Received ${start}.`);
  }

  if (start < 0 || start + RANGE_SIZE - 1 > BMP_END) {
    throw new RangeError(`Range start must produce a BMP range between 0 and ${BMP_END}. Received ${start}.`);
  }

  if (start % RANGE_SIZE !== 0) {
    throw new RangeError(`Range start must be aligned to ${RANGE_SIZE}. Received ${start}.`);
  }
}
