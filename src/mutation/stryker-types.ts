export interface StrykerFileReport {
  mutationScore: number;
  nrOfMutants: number;
  nrOfKilledMutants: number;
  nrOfSurvivedMutants: number;
}

export interface StrykerReport {
  mutationScore: number;
  nrOfMutants: number;
  nrOfKilledMutants: number;
  nrOfSurvivedMutants: number;
  files?: Record<string, StrykerFileReport>;
}
