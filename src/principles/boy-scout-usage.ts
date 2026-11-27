/**
 * The usage text for the Boy Scout CLI.
 *
 * A separate module because the text is DATA, not logic: inside `boy-scout.ts` the
 * multi-line template was folded into `showHelp`'s complexity by the gate's brace
 * verification, which reported 7-8 for a function whose body is one `console.log`.
 */

export const USAGE_TEXT = `
Usage: boy-scout <options>
Options:
  --new-files <file1,file2,...>    Specify new files to analyze
  --modified-files <file1,file2,...>    Specify modified files to analyze  
  --baseline <path>                Path to baseline file (default: .warnings-baseline.json)
  --init-baseline [file1,file2,...]    Initialize baseline with current warning counts
  --prune-baseline                 Report baseline entries whose files are gone
  --apply                          With --prune-baseline: actually remove them
  --config <path>                  Path to .principlesrc (default: git toplevel)
  --help                          Show this help message
  
Examples:
  npx tsx boy-scout.ts --new-files src/new-file.ts
  npx tsx boy-scout.ts --modified-files src/changed-file.ts --baseline my-baseline.json
  npx tsx boy-scout.ts --init-baseline src/file1.ts,src/file2.ts
  npx tsx boy-scout.ts --prune-baseline --apply
`;
