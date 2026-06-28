export interface Summary {
  fontstack: string;
  fileCount: number;
  output: string;
}

export function printSummary({ fontstack, fileCount, output }: Summary): void {
  console.log('Generated:');
  console.log(`  Font stack:  ${fontstack}`);
  console.log(`  Files:       ${fileCount}`);
  console.log(`  Output:      ${output}`);
  console.log('Done.');
}

export interface SkippedSummary {
  fontstack: string;
  output: string;
}

export function printUpToDate({ fontstack, output }: SkippedSummary): void {
  console.log(`Up to date - skipped "${fontstack}" in ${output} (pass --force to regenerate).`);
}
