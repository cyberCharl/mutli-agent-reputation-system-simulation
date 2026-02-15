import { AgentRole, ScenarioType } from '../types';

export interface PersonaSeed {
  id: number;
  name: string;
  role: AgentRole | null;
  innate: string;
}

const FIRST_NAMES = [
  'Alex',
  'Blair',
  'Casey',
  'Devon',
  'Emery',
  'Finley',
  'Gray',
  'Harper',
  'Indigo',
  'Jules',
  'Kai',
  'Logan',
  'Morgan',
  'Nico',
  'Oakley',
  'Parker',
  'Quinn',
  'River',
  'Sawyer',
  'Taylor',
];

function defaultRoleForScenario(scenario: ScenarioType): AgentRole | null {
  if (scenario === 'mspn') {
    return 'player';
  }
  if (scenario === 'investment') {
    return 'investor';
  }
  if (scenario === 'pd_game') {
    return 'player';
  }
  if (scenario === 'sign_up') {
    return 'resident';
  }
  return null;
}

export function generatePersonaSeeds(
  count: number,
  scenario: ScenarioType = 'mspn'
): PersonaSeed[] {
  const role = defaultRoleForScenario(scenario);
  const safeCount = Math.max(0, Math.floor(count));
  const seeds: PersonaSeed[] = [];

  for (let i = 0; i < safeCount; i += 1) {
    const baseName = FIRST_NAMES[i % FIRST_NAMES.length];
    const suffix = Math.floor(i / FIRST_NAMES.length) + 1;
    const name = suffix > 1 ? `${baseName}${suffix}` : baseName;

    seeds.push({
      id: i + 1,
      name,
      role,
      innate: 'Adaptive, strategic, and reputation-aware social agent.',
    });
  }

  return seeds;
}
