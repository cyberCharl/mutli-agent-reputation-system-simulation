/**
 * Persona seed generation — Ported from RepuNet's sim_storage/change_sim_folder.py
 *
 * Generates initial agent personas with configurable count and personality types.
 */

import seedrandom from 'seedrandom';
import { AgentState } from '../types';
import { createAgentState } from './scratch';

/** Default persona templates: 10 Rational + 10 Altruistic (matches RepuNet defaults) */
const DEFAULT_PERSONAS: Array<{ name: string; type: 'rational' | 'altruistic' }> = [
  { name: 'Rational_Agent_1', type: 'rational' },
  { name: 'Rational_Agent_2', type: 'rational' },
  { name: 'Rational_Agent_3', type: 'rational' },
  { name: 'Rational_Agent_4', type: 'rational' },
  { name: 'Rational_Agent_5', type: 'rational' },
  { name: 'Rational_Agent_6', type: 'rational' },
  { name: 'Rational_Agent_7', type: 'rational' },
  { name: 'Rational_Agent_8', type: 'rational' },
  { name: 'Rational_Agent_9', type: 'rational' },
  { name: 'Rational_Agent_10', type: 'rational' },
  { name: 'Altruistic_Agent_1', type: 'altruistic' },
  { name: 'Altruistic_Agent_2', type: 'altruistic' },
  { name: 'Altruistic_Agent_3', type: 'altruistic' },
  { name: 'Altruistic_Agent_4', type: 'altruistic' },
  { name: 'Altruistic_Agent_5', type: 'altruistic' },
  { name: 'Altruistic_Agent_6', type: 'altruistic' },
  { name: 'Altruistic_Agent_7', type: 'altruistic' },
  { name: 'Altruistic_Agent_8', type: 'altruistic' },
  { name: 'Altruistic_Agent_9', type: 'altruistic' },
  { name: 'Altruistic_Agent_10', type: 'altruistic' },
];

const RATIONAL_DESCRIPTION =
  'A self-interested agent focused on maximizing personal returns. Makes calculated decisions based on expected value and risk assessment.';

const ALTRUISTIC_DESCRIPTION =
  'A cooperative agent focused on mutual benefit. Values trust-building and long-term relationships over short-term gains.';

export interface PersonaSeed {
  name: string;
  type: 'rational' | 'altruistic';
  description: string;
}

/** Generate persona seeds for a given agent count */
export function generatePersonaSeeds(
  count: number,
  seed?: string
): PersonaSeed[] {
  const rng = seedrandom(seed || 'persona-seed');

  if (count <= DEFAULT_PERSONAS.length) {
    // Use default personas, shuffled
    const shuffled = [...DEFAULT_PERSONAS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count).map((p) => ({
      ...p,
      description:
        p.type === 'rational' ? RATIONAL_DESCRIPTION : ALTRUISTIC_DESCRIPTION,
    }));
  }

  // Generate extra personas beyond the default 20
  const seeds: PersonaSeed[] = DEFAULT_PERSONAS.map((p) => ({
    ...p,
    description:
      p.type === 'rational' ? RATIONAL_DESCRIPTION : ALTRUISTIC_DESCRIPTION,
  }));

  for (let i = DEFAULT_PERSONAS.length; i < count; i++) {
    const isRational = rng() < 0.5;
    seeds.push({
      name: `${isRational ? 'Rational' : 'Altruistic'}_Agent_${i + 1}`,
      type: isRational ? 'rational' : 'altruistic',
      description: isRational ? RATIONAL_DESCRIPTION : ALTRUISTIC_DESCRIPTION,
    });
  }

  return seeds;
}

/** Create initialized AgentState instances from persona seeds */
export function createAgentsFromSeeds(
  seeds: PersonaSeed[],
  resourcesUnit: number = 10
): AgentState[] {
  return seeds.map((s, i) => {
    const state = createAgentState(s.name, i, resourcesUnit);
    state.learned['personality'] = s.description;
    state.learned['type'] = s.type;
    return state;
  });
}
