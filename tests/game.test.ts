import { MSPNGame } from '../src/game';
import { ProtocolLevel, ReviewAction, TrueState, Phase } from '../src/types';

describe('MSPNGame', () => {
  let game: MSPNGame;

  beforeEach(() => {
    game = new MSPNGame('test-seed');
  });

  describe('Initialization', () => {
    test('should initialize with correct phase', () => {
      const state = game.getState();
      expect(state.phase).toBe(Phase.Proposal);
      expect(state.proposal).toBeUndefined();
      expect(state.reviewAction).toBeUndefined();
      expect(state.payoffs).toBeNull();
    });

    test('should have valid true state', () => {
      const state = game.getState();
      expect([TrueState.SafeLow, TrueState.DangerousLow]).toContain(
        state.trueState
      );
    });

    test('should initialize beliefs that sum to 1', () => {
      const state = game.getState();
      const beliefA = state.agentBeliefs.a;
      const beliefB = state.agentBeliefs.b;

      expect(
        beliefA.own[TrueState.SafeLow] + beliefA.own[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
      expect(
        beliefA.aboutOpponent[TrueState.SafeLow] +
          beliefA.aboutOpponent[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
      expect(
        beliefB.own[TrueState.SafeLow] + beliefB.own[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
      expect(
        beliefB.aboutOpponent[TrueState.SafeLow] +
          beliefB.aboutOpponent[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
    });

    test('should have empty history initially', () => {
      const state = game.getState();
      expect(state.history).toEqual([]);
    });
  });

  describe('Proposal Phase', () => {
    test('should accept valid proposal', () => {
      game.setProposal(ProtocolLevel.Low);
      const state = game.getState();

      expect(state.phase).toBe(Phase.Review);
      expect(state.proposal).toBe(ProtocolLevel.Low);
      expect(state.history).toContain('A proposed low');
    });

    test('should reject proposal in wrong phase', () => {
      game.setProposal(ProtocolLevel.Low);
      game.setReview(ReviewAction.Accept);

      expect(() => {
        game.setProposal(ProtocolLevel.Medium);
      }).toThrow('Cannot set proposal in phase execution');
    });

    test('should update beliefs after proposal', () => {
      const initialState = game.getState();
      const initialBelief = initialState.agentBeliefs.a.own[TrueState.SafeLow];

      game.setProposal(ProtocolLevel.Low);
      const newState = game.getState();
      const newBelief = newState.agentBeliefs.a.own[TrueState.SafeLow];

      // Proposing low should increase belief in safe state
      expect(newBelief).toBeGreaterThan(initialBelief);
    });
  });

  describe('Review Phase', () => {
    beforeEach(() => {
      game.setProposal(ProtocolLevel.Low);
    });

    test('should accept valid review action', () => {
      game.setReview(ReviewAction.Accept);
      const state = game.getState();

      expect(state.phase).toBe(Phase.Execution);
      expect(state.reviewAction).toBe(ReviewAction.Accept);
      expect(state.history).toContain('B chose accept');
    });

    test('should reject review in wrong phase', () => {
      // Reset game to proposal phase
      const newGame = new MSPNGame('test-seed');
      expect(() => {
        newGame.setReview(ReviewAction.Accept);
      }).toThrow('Cannot set review in phase proposal');
    });

    test('should update beliefs after review', () => {
      const initialState = game.getState();
      const initialBelief = initialState.agentBeliefs.b.own[TrueState.SafeLow];

      game.setReview(ReviewAction.Accept);
      const newState = game.getState();
      const newBelief = newState.agentBeliefs.b.own[TrueState.SafeLow];

      // Accepting should increase belief in safe state
      expect(newBelief).toBeGreaterThan(initialBelief);
    });
  });

  describe('Execution Phase', () => {
    test('should resolve secure coordination (high protocol)', () => {
      game.setProposal(ProtocolLevel.High);
      game.setReview(ReviewAction.Accept);

      const finalState = game.resolveExecution();

      expect(finalState.phase).toBe(Phase.End);
      expect(finalState.finalProtocol).toBe(ProtocolLevel.High);
      expect(finalState.payoffs).toEqual({ a: 10, b: 10 });
    });

    test('should resolve secure coordination (medium protocol)', () => {
      game.setProposal(ProtocolLevel.Medium);
      game.setReview(ReviewAction.Accept);

      const finalState = game.resolveExecution();

      expect(finalState.phase).toBe(Phase.End);
      expect(finalState.finalProtocol).toBe(ProtocolLevel.Medium);
      expect(finalState.payoffs).toEqual({ a: 10, b: 10 });
    });

    test('should resolve risky success (low protocol, safe state)', () => {
      // Force safe state for this test
      const safeGame = new MSPNGame('safe-test');
      const state = safeGame.getState();

      if (state.trueState === TrueState.SafeLow) {
        safeGame.setProposal(ProtocolLevel.Low);
        safeGame.setReview(ReviewAction.Accept);

        const finalState = safeGame.resolveExecution();

        expect(finalState.finalProtocol).toBe(ProtocolLevel.Low);
        expect(finalState.payoffs).toEqual({ a: 12, b: 8 });
      }
    });

    test('should resolve breach (low protocol, dangerous state)', () => {
      // Force dangerous state for this test
      const dangerousGame = new MSPNGame('dangerous-test');
      const state = dangerousGame.getState();

      if (state.trueState === TrueState.DangerousLow) {
        dangerousGame.setProposal(ProtocolLevel.Low);
        dangerousGame.setReview(ReviewAction.Accept);

        const finalState = dangerousGame.resolveExecution();

        expect(finalState.finalProtocol).toBe(ProtocolLevel.Low);
        expect(finalState.payoffs).toEqual({ a: -5, b: -5 });
      }
    });

    test('should resolve rejection', () => {
      game.setProposal(ProtocolLevel.Low);
      game.setReview(ReviewAction.Reject);

      const finalState = game.resolveExecution();

      expect(finalState.phase).toBe(Phase.End);
      expect(finalState.finalProtocol).toBeUndefined();
      expect(finalState.payoffs).toEqual({ a: 2, b: 2 });
    });

    test('should resolve modification', () => {
      game.setProposal(ProtocolLevel.Low);
      game.setReview(ReviewAction.ModifyHigh);

      const finalState = game.resolveExecution();

      expect(finalState.phase).toBe(Phase.End);
      expect(finalState.finalProtocol).toBe(ProtocolLevel.High);
      expect(finalState.payoffs).toEqual({ a: 10, b: 10 });
    });

    test('should reject execution in wrong phase', () => {
      expect(() => {
        game.resolveExecution();
      }).toThrow('Cannot resolve execution in phase proposal');
    });
  });

  describe('Game State Management', () => {
    test('should track game over state', () => {
      expect(game.isGameOver()).toBe(false);

      game.setProposal(ProtocolLevel.Low);
      game.setReview(ReviewAction.Accept);
      game.resolveExecution();

      expect(game.isGameOver()).toBe(true);
    });

    test('should return current phase', () => {
      expect(game.getCurrentPhase()).toBe(Phase.Proposal);

      game.setProposal(ProtocolLevel.Low);
      expect(game.getCurrentPhase()).toBe(Phase.Review);

      game.setReview(ReviewAction.Accept);
      expect(game.getCurrentPhase()).toBe(Phase.Execution);

      game.resolveExecution();
      expect(game.getCurrentPhase()).toBe(Phase.End);
    });

    test('should end game properly', () => {
      game.setProposal(ProtocolLevel.Low);
      game.setReview(ReviewAction.Accept);
      game.resolveExecution();

      const finalState = game.endGame();
      expect(finalState.phase).toBe(Phase.End);
    });

    test('should reject ending unfinished game', () => {
      expect(() => {
        game.endGame();
      }).toThrow('Game not finished, current phase: proposal');
    });
  });

  describe('Belief Updates', () => {
    test('should normalize beliefs after updates', () => {
      const initialState = game.getState();
      const beliefA = initialState.agentBeliefs.a;

      game.setProposal(ProtocolLevel.Low);
      const newState = game.getState();
      const newBeliefA = newState.agentBeliefs.a;

      // Beliefs should still sum to 1
      expect(
        newBeliefA.own[TrueState.SafeLow] +
          newBeliefA.own[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
      expect(
        newBeliefA.aboutOpponent[TrueState.SafeLow] +
          newBeliefA.aboutOpponent[TrueState.DangerousLow]
      ).toBeCloseTo(1, 5);
    });

    test('should update beliefs based on action type', () => {
      const initialState = game.getState();
      const initialSafeBelief =
        initialState.agentBeliefs.a.own[TrueState.SafeLow];

      // Proposing low should increase safe belief
      game.setProposal(ProtocolLevel.Low);
      const afterProposal = game.getState();
      expect(
        afterProposal.agentBeliefs.a.own[TrueState.SafeLow]
      ).toBeGreaterThan(initialSafeBelief);

      // Accepting should further increase safe belief
      game.setReview(ReviewAction.Accept);
      const afterReview = game.getState();
      expect(
        afterReview.agentBeliefs.b.own[TrueState.SafeLow]
      ).toBeGreaterThanOrEqual(
        afterProposal.agentBeliefs.b.own[TrueState.SafeLow]
      );
    });
  });

  describe('Reproducibility', () => {
    test('should produce same results with same seed', () => {
      const game1 = new MSPNGame('test-seed');
      const game2 = new MSPNGame('test-seed');

      const state1 = game1.getState();
      const state2 = game2.getState();

      expect(state1.trueState).toBe(state2.trueState);
      expect(state1.agentBeliefs.a.own[TrueState.SafeLow]).toBeCloseTo(
        state2.agentBeliefs.a.own[TrueState.SafeLow],
        5
      );
    });

    test('should produce different results with different seeds', () => {
      const game1 = new MSPNGame('seed1');
      const game2 = new MSPNGame('seed2');

      const state1 = game1.getState();
      const state2 = game2.getState();

      // At least one aspect should be different
      const beliefsDifferent =
        state1.agentBeliefs.a.own[TrueState.SafeLow] !==
          state2.agentBeliefs.a.own[TrueState.SafeLow] ||
        state1.trueState !== state2.trueState;

      expect(beliefsDifferent).toBe(true);
    });
  });
});
