import { AblationMode, AblationVariant, SimulationConfig } from '../types';

const VARIANTS: Record<AblationMode, AblationVariant> = {
  full: {
    mode: 'full',
    enableReputation: true,
    enableGossip: true,
    reputationBackend: 'repunet',
  },
  no_gossip: {
    mode: 'no_gossip',
    enableReputation: true,
    enableGossip: false,
    reputationBackend: 'repunet',
  },
  no_reputation: {
    mode: 'no_reputation',
    enableReputation: false,
    enableGossip: true,
    reputationBackend: 'karma',
  },
  minimal: {
    mode: 'minimal',
    enableReputation: false,
    enableGossip: false,
    reputationBackend: 'karma',
  },
};

export function resolveAblationVariant(mode: AblationMode): AblationVariant {
  return { ...VARIANTS[mode] };
}

export function applyAblationVariant(
  config: SimulationConfig,
  mode: AblationMode
): SimulationConfig {
  const variant = resolveAblationVariant(mode);

  return {
    ...config,
    ablationMode: mode,
    enableGossip: variant.enableGossip,
    reputationBackend: variant.reputationBackend,
    gossipConfig: {
      ...config.gossipConfig,
      enabled: variant.enableGossip,
    },
  };
}
