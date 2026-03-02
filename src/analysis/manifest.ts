import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentManifest,
  SampleSizePlan,
  AnalysisPlan,
  Hypothesis,
} from '../types';

export type {
  AnalysisPlan,
  ExperimentManifest,
  Hypothesis,
  SampleSizePlan,
} from '../types';

export function createExperimentManifest(
  manifest: Omit<ExperimentManifest, 'createdAt'>
): ExperimentManifest {
  return {
    ...manifest,
    createdAt: new Date().toISOString(),
  };
}

export function loadExperimentManifest(
  manifestPath: string
): ExperimentManifest {
  const resolvedPath = path.resolve(manifestPath);
  const manifest = JSON.parse(
    fs.readFileSync(resolvedPath, 'utf8')
  ) as ExperimentManifest;

  validateExperimentManifest(manifest);

  return manifest;
}

export function saveExperimentManifest(
  manifestPath: string,
  manifest: ExperimentManifest
): void {
  const resolvedPath = path.resolve(manifestPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(manifest, null, 2));
}

export function getManifestWarnings(
  manifest: ExperimentManifest,
  plannedEpisodes: number
): string[] {
  const warnings: string[] = [];

  if (plannedEpisodes < manifest.sampleSize.computedMinimum) {
    warnings.push(
      `Planned episodes (${plannedEpisodes}) are below the preregistered minimum (${manifest.sampleSize.computedMinimum}).`
    );
  }

  if (
    manifest.secondaryMetrics.length > 0 &&
    manifest.analysisPlan.correctionMethod === 'none'
  ) {
    warnings.push(
      'Multiple metrics are listed in the manifest without a multiple-comparison correction.'
    );
  }

  return warnings;
}

export function validateExperimentManifest(
  manifest: ExperimentManifest
): void {
  if (!manifest.experimentId) {
    throw new Error('Manifest experimentId is required');
  }
  if (!manifest.primaryMetric) {
    throw new Error('Manifest primaryMetric is required');
  }
  if (!Array.isArray(manifest.hypotheses) || manifest.hypotheses.length === 0) {
    throw new Error('Manifest must declare at least one hypothesis');
  }
  if (!Number.isFinite(manifest.sampleSize.computedMinimum)) {
    throw new Error('Manifest sampleSize.computedMinimum must be numeric');
  }
}
