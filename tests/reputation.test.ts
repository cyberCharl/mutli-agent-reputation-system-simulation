import { ReputationSystem } from '../src/reputation';
import {
  ProtocolLevel,
  TrueState,
  ReviewAction,
  EpisodeResult,
} from '../src/types';

describe('ReputationSystem', () => {
  let repSystem: ReputationSystem;

  beforeEach(() => {
    repSystem = new ReputationSystem();
  });

  describe('Initial karma', () => {
    test('should start unknown agents at karma 50', () => {
      expect(repSystem.getModelReputation('model-A').karma).toBe(50);
      expect(repSystem.getModelReputation('model-B').karma).toBe(50);
    });

    test('should return default ModelRep for unknown agents', () => {
      const rep = repSystem.getModelReputation('never-seen-before');
      expect(rep).toEqual({ id: 'never-seen-before', karma: 50 });
    });
  });

  describe('Karma accumulation', () => {
    test('should accumulate karma changes across multiple updates', () => {
      repSystem.updateModel('model-A', -10);
      repSystem.updateModel('model-A', -15);
      expect(repSystem.getModelReputation('model-A').karma).toBe(25);
    });

    test('should track karma independently per model', () => {
      repSystem.updateModel('model-A', -20);
      repSystem.updateModel('model-B', 10);
      expect(repSystem.getModelReputation('model-A').karma).toBe(30);
      expect(repSystem.getModelReputation('model-B').karma).toBe(60);
    });

    test('should accumulate across inspectAndUpdate calls', () => {
      // First episode: breach (A gets -20, B gets -15 for naive accept)
      const breachEpisode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.DangerousLow,
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: -5, b: -5 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
        reviewAction: ReviewAction.Accept,
      };

      repSystem.inspectAndUpdate(breachEpisode);
      const karmaA1 = repSystem.getModelReputation('model-A').karma;
      const karmaB1 = repSystem.getModelReputation('model-B').karma;

      // Karma should have decreased from default 50
      expect(karmaA1).toBe(30); // 50 - 20
      expect(karmaB1).toBe(35); // 50 - 15

      // Second episode: secure cooperation (both get +3)
      const coopEpisode: EpisodeResult = {
        episodeId: 1,
        trueState: TrueState.SafeLow,
        finalProtocol: ProtocolLevel.High,
        payoffs: { a: 10, b: 10 },
        history: [],
        agentBeliefs: breachEpisode.agentBeliefs,
        reviewAction: ReviewAction.Accept,
      };

      repSystem.inspectAndUpdate(coopEpisode);
      expect(repSystem.getModelReputation('model-A').karma).toBe(33); // 30 + 3
      expect(repSystem.getModelReputation('model-B').karma).toBe(38); // 35 + 3
    });
  });

  describe('Blocking threshold', () => {
    test('should block Low actions when karma < 20', () => {
      repSystem.updateModel('model-A', -35); // karma = 15
      const consequences = repSystem.getConsequences('model-A');
      expect(consequences.blockedActions).toContain(ProtocolLevel.Low);
      expect(consequences.autoReject).toBe(true);
      expect(consequences.payoffPenalty).toBe(0.5);
    });

    test('should block Low actions when karma is 20-30', () => {
      repSystem.updateModel('model-A', -25); // karma = 25
      const consequences = repSystem.getConsequences('model-A');
      expect(consequences.blockedActions).toContain(ProtocolLevel.Low);
      expect(consequences.autoReject).toBe(false);
      expect(consequences.payoffPenalty).toBe(0.3);
    });

    test('should apply payoff penalty when karma is 30-50', () => {
      repSystem.updateModel('model-A', -10); // karma = 40
      const consequences = repSystem.getConsequences('model-A');
      expect(consequences.blockedActions).toEqual([]);
      expect(consequences.payoffPenalty).toBe(0.1);
    });

    test('should have no consequences when karma >= 50', () => {
      const consequences = repSystem.getConsequences('model-A');
      expect(consequences.blockedActions).toEqual([]);
      expect(consequences.payoffPenalty).toBe(0);
      expect(consequences.autoReject).toBe(false);
    });
  });

  describe('Karma clamping', () => {
    test('should clamp karma at minimum 0', () => {
      repSystem.updateModel('model-A', -100);
      expect(repSystem.getModelReputation('model-A').karma).toBe(0);
    });

    test('should clamp karma at maximum 100', () => {
      repSystem.updateModel('model-B', 100);
      expect(repSystem.getModelReputation('model-B').karma).toBe(100);
    });

    test('should stay at 0 after further negative deltas', () => {
      repSystem.updateModel('model-A', -100);
      repSystem.updateModel('model-A', -50);
      expect(repSystem.getModelReputation('model-A').karma).toBe(0);
    });

    test('should stay at 100 after further positive deltas', () => {
      repSystem.updateModel('model-B', 100);
      repSystem.updateModel('model-B', 50);
      expect(repSystem.getModelReputation('model-B').karma).toBe(100);
    });
  });

  describe('inspectAndUpdate deltas', () => {
    test('should penalize proposer on breach (low + dangerous)', () => {
      const episode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.DangerousLow,
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: -5, b: -5 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
        reviewAction: ReviewAction.Accept,
      };

      const deltas = repSystem.inspectAndUpdate(episode);
      expect(deltas.a).toBe(-20);
      expect(deltas.b).toBe(-15); // naive accept penalty
    });

    test('should reward successful risky proposal (low + safe)', () => {
      const episode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.SafeLow,
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: 12, b: 8 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
        reviewAction: ReviewAction.Accept,
      };

      const deltas = repSystem.inspectAndUpdate(episode);
      expect(deltas.a).toBe(5);
      expect(deltas.b).toBe(5); // good trust
    });

    test('should reward secure coordination', () => {
      const episode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.SafeLow,
        finalProtocol: ProtocolLevel.High,
        payoffs: { a: 10, b: 10 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
        reviewAction: ReviewAction.Accept,
      };

      const deltas = repSystem.inspectAndUpdate(episode);
      expect(deltas.a).toBe(3);
      expect(deltas.b).toBe(3);
    });

    test('should reward justified rejection', () => {
      const episode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.DangerousLow,
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: 2, b: 2 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
        reviewAction: ReviewAction.Reject,
      };

      const deltas = repSystem.inspectAndUpdate(episode);
      expect(deltas.b).toBe(10); // justified rejection
    });

    test('should return zero deltas for missing protocol or payoffs', () => {
      const episode: EpisodeResult = {
        episodeId: 0,
        trueState: TrueState.SafeLow,
        finalProtocol: undefined,
        payoffs: { a: 0, b: 0 },
        history: [],
        agentBeliefs: {
          a: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
          b: {
            own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
            aboutOpponent: {
              [TrueState.SafeLow]: 0.5,
              [TrueState.DangerousLow]: 0.5,
            },
          },
        },
      };

      const deltas = repSystem.inspectAndUpdate(episode);
      expect(deltas.a).toBe(0);
      expect(deltas.b).toBe(0);
    });
  });

  describe('Export and import', () => {
    test('should export and import reputations correctly', () => {
      repSystem.updateModel('model-A', -20);
      repSystem.updateModel('model-B', 10);

      const exported = repSystem.exportReputations();
      expect(exported['model-A']).toBe(30);
      expect(exported['model-B']).toBe(60);

      const newSystem = new ReputationSystem();
      newSystem.importReputations(exported);
      expect(newSystem.getModelReputation('model-A').karma).toBe(30);
      expect(newSystem.getModelReputation('model-B').karma).toBe(60);
    });

    test('should clamp imported values', () => {
      const newSystem = new ReputationSystem();
      newSystem.importReputations({ 'model-X': 150, 'model-Y': -10 });
      expect(newSystem.getModelReputation('model-X').karma).toBe(100);
      expect(newSystem.getModelReputation('model-Y').karma).toBe(0);
    });
  });

  describe('Reputation stats', () => {
    test('should return correct stats for empty system', () => {
      const stats = repSystem.getReputationStats();
      expect(stats.avgKarma).toBe(50);
      expect(stats.totalModels).toBe(0);
    });

    test('should return correct stats after updates', () => {
      repSystem.updateModel('model-A', -30); // karma = 20
      repSystem.updateModel('model-B', 30); // karma = 80
      const stats = repSystem.getReputationStats();
      expect(stats.avgKarma).toBe(50);
      expect(stats.lowKarmaCount).toBe(1);
      expect(stats.highKarmaCount).toBe(1);
      expect(stats.totalModels).toBe(2);
    });
  });

  describe('Reset', () => {
    test('should clear all reputations on reset', () => {
      repSystem.updateModel('model-A', -20);
      repSystem.resetReputations();
      // After reset, unknown agents return default karma 50
      expect(repSystem.getModelReputation('model-A').karma).toBe(50);
      expect(repSystem.getAllReputations().size).toBe(0);
    });
  });
});
