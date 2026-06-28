import { parseArgs } from 'node:util';

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; configPath: string };

export function parseCliArgs(argv: string[]): ParsedArgs {
  let values;
  let positionals;

  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  if (values.help) {
    return { kind: 'help' };
  }

  if (values.version) {
    return { kind: 'version' };
  }

  if (positionals.length === 0) {
    throw new Error('Missing required config file path.');
  }

  if (positionals.length > 1) {
    throw new Error(
      `Expected a single config file path, but received ${positionals.length} arguments.`,
    );
  }

  return { kind: 'run', configPath: positionals[0]! };
}
