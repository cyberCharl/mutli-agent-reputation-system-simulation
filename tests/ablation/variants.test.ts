import {
  applyAblationVariant,
  resolveAblationVariant,
} from '../../src/ablation/variants';
import { SimulationConfig } from '../../src/types';

const baseConfig: SimulationConfig = {
  maxRounds: 5,
  beliefUpdateStrength: {
    proposal: 0.3,
    review: 0.4,
  },
  payoffNoise: 0,
  initialBeliefAlignment: 0.5,
  agentCount: 4,
  scenario: 'mspn',
  reputationBackend: 'repunet',
  enableGossip: true,
  gossipConfig: {
    enabled: true,
    maxSpreadDepth: 3,
    credibilityDecay: 0.2,
    recentWindow: 5,
    listenerSelection: 'random',
  },
  enableNetwork: true,
  networkConfig: {
    enabled: true,
    blackListMaxSize: 3,
    observationInterval: 1,
    initialConnectivity: 0.2,
  },
  storageConfig: {
    basePath: 'tmp',
    runId: 'test',
    persistInterval: 10,
  },
  ablationMode: 'full',
};

describe('ablation variants', () => {
  test('resolves each variant consistently', () => {
    expect(resolveAblationVariant('full')).toEqual({
      mode: 'full',
      enableReputation: true,
      enableGossip: true,
      reputationBackend: 'repunet',
    });
    expect(resolveAblationVariant('no_gossip').enableGossip).toBe(false);
    expect(resolveAblationVariant('no_reputation').reputationBackend).toBe(
      'karma'
    );
    expect(resolveAblationVariant('minimal')).toEqual({
      mode: 'minimal',
      enableReputation: false,
      enableGossip: false,
      reputationBackend: 'karma',
    });
  });

  test('returns a copy when resolving variants', () => {
    const first = resolveAblationVariant('full');
    first.enableGossip = false;

    const second = resolveAblationVariant('full');
    expect(second.enableGossip).toBe(true);
  });

  test('applies variant fields without mutating input config', () => {
    const next = applyAblationVariant(baseConfig, 'minimal');

    expect(next.ablationMode).toBe('minimal');
    expect(next.enableGossip).toBe(false);
    expect(next.reputationBackend).toBe('karma');
    expect(next.gossipConfig.enabled).toBe(false);

    expect(baseConfig.enableGossip).toBe(true);
    expect(baseConfig.reputationBackend).toBe('repunet');
    expect(baseConfig.gossipConfig.enabled).toBe(true);
  });
});
