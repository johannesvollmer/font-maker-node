export function ccallNumber(
  module: FontMakerModule,
  ident: string,
  argTypes: CcallArgumentType[],
  args: Array<number | string>,
): number {
  const result = module.ccall(ident, 'number', argTypes, args);

  if (typeof result !== 'number') {
    throw new Error(`Expected ${ident} to return a number.`);
  }

  return result;
}

export function ccallVoid(
  module: FontMakerModule,
  ident: string,
  argTypes: CcallArgumentType[],
  args: Array<number | string>,
): void {
  module.ccall(ident, null, argTypes, args);
}
