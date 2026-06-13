import fs from 'fs/promises';
import path from 'path';

interface MutationScoreEntry {
  score: number;
  mutants: number;
  killed: number;
  survived: number;
}

interface MutationBaseline {
  version: string;
  generatedAt: string;
  source: 'local' | 'ci';
  scores: Record<string, MutationScoreEntry>;
}

interface ParsedScoreInput {
  filePath: string;
  score: number;
}

function parseArgs(): { scores: ParsedScoreInput[] } {
  const args = process.argv.slice(2);
  let scoresInput = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scores' && args[i + 1]) {
      scoresInput = args[i + 1];
      i++;
    }
  }

  if (!scoresInput) {
    throw new Error('Missing required argument: --scores "file1.ts:65.2,file2.ts:58.0"');
  }

  const scores: ParsedScoreInput[] = [];
  const entries = scoresInput.split(',');

  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid score format: ${entry}. Expected "file.ts:score"`);
    }

    const [filePath, scoreStr] = parts;
    const score = parseFloat(scoreStr);

    if (Number.isNaN(score) || score < 0 || score > 100) {
      throw new Error(`Invalid score value for ${filePath}: ${scoreStr}. Must be between 0 and 100.`);
    }

    scores.push({ filePath: filePath.trim(), score });
  }

  return { scores };
}

async function readBaseline(baselinePath: string): Promise<MutationBaseline> {
  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    return JSON.parse(content) as MutationBaseline;
  } catch (error: unknown) {
    throw new Error(
      `Failed to read baseline file at ${baselinePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function updateBaseline(
  baseline: MutationBaseline,
  newScores: ParsedScoreInput[]
): MutationBaseline {
  const updatedScores: Record<string, MutationScoreEntry> = { ...baseline.scores };

    for (const { filePath, score } of newScores) {
      const existing = updatedScores[filePath];

      if (existing) {
        updatedScores[filePath] = {
          ...existing,
          score: parseFloat(score.toFixed(1))
        };
      } else {
        updatedScores[filePath] = {
          score: parseFloat(score.toFixed(1)),
          mutants: 0,
          killed: 0,
          survived: 0
        };
      }
    }

  return {
    ...baseline,
    generatedAt: new Date().toISOString(),
    scores: updatedScores
  };
}

async function removeDeletedFiles(baseline: MutationBaseline): Promise<MutationBaseline> {
  const validScores: Record<string, MutationScoreEntry> = {};

  for (const [filePath, entry] of Object.entries(baseline.scores)) {
    const absolutePath = path.resolve(process.cwd(), filePath);
    if (await fileExists(absolutePath)) {
      validScores[filePath] = entry;
    } else {
      console.log(`Removing deleted file from baseline: ${filePath}`);
    }
  }

  return {
    ...baseline,
    scores: validScores
  };
}

async function saveBaseline(baseline: MutationBaseline, baselinePath: string): Promise<void> {
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
}

async function main(): Promise<void> {
  const { scores } = parseArgs();
  const baselinePath = path.join(process.cwd(), '.mutation-baseline.json');

  console.log('Reading existing mutation baseline...');
  const baseline = await readBaseline(baselinePath);

  console.log(`Updating ${scores.length} file score(s)...`);
  let updatedBaseline = updateBaseline(baseline, scores);

  console.log('Checking for deleted files...');
  updatedBaseline = await removeDeletedFiles(updatedBaseline);

  await saveBaseline(updatedBaseline, baselinePath);

  console.log(`Mutation baseline updated and saved to ${baselinePath}`);
  console.log(`Total files: ${Object.keys(updatedBaseline.scores).length}`);

  for (const { filePath, score } of scores) {
    console.log(`  ${filePath}: ${score}%`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Failed to update mutation baseline: ${message}`);
  process.exit(1);
});
