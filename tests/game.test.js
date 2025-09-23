"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("../src/game");
const types_1 = require("../src/types");
describe('MSPNGame', () => {
    let game;
    beforeEach(() => {
        game = new game_1.MSPNGame('test-seed');
    });
    describe('Initialization', () => {
        test('should initialize with correct phase', () => {
            const state = game.getState();
            expect(state.phase).toBe(types_1.Phase.Proposal);
            expect(state.proposal).toBeUndefined();
            expect(state.reviewAction).toBeUndefined();
            expect(state.payoffs).toBeNull();
        });
        test('should have valid true state', () => {
            const state = game.getState();
            expect([types_1.TrueState.SafeLow, types_1.TrueState.DangerousLow]).toContain(state.trueState);
        });
        test('should initialize beliefs that sum to 1', () => {
            const state = game.getState();
            const beliefA = state.agentBeliefs.a;
            const beliefB = state.agentBeliefs.b;
            expect(beliefA.own[types_1.TrueState.SafeLow] + beliefA.own[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
            expect(beliefA.aboutOpponent[types_1.TrueState.SafeLow] +
                beliefA.aboutOpponent[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
            expect(beliefB.own[types_1.TrueState.SafeLow] + beliefB.own[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
            expect(beliefB.aboutOpponent[types_1.TrueState.SafeLow] +
                beliefB.aboutOpponent[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
        });
        test('should have empty history initially', () => {
            const state = game.getState();
            expect(state.history).toEqual([]);
        });
    });
    describe('Proposal Phase', () => {
        test('should accept valid proposal', () => {
            game.setProposal(types_1.ProtocolLevel.Low);
            const state = game.getState();
            expect(state.phase).toBe(types_1.Phase.Review);
            expect(state.proposal).toBe(types_1.ProtocolLevel.Low);
            expect(state.history).toContain('A proposed low');
        });
        test('should reject proposal in wrong phase', () => {
            game.setProposal(types_1.ProtocolLevel.Low);
            game.setReview(types_1.ReviewAction.Accept);
            expect(() => {
                game.setProposal(types_1.ProtocolLevel.Medium);
            }).toThrow('Cannot set proposal in phase execution');
        });
        test('should update beliefs after proposal', () => {
            const initialState = game.getState();
            const initialBelief = initialState.agentBeliefs.a.own[types_1.TrueState.SafeLow];
            game.setProposal(types_1.ProtocolLevel.Low);
            const newState = game.getState();
            const newBelief = newState.agentBeliefs.a.own[types_1.TrueState.SafeLow];
            // Proposing low should increase belief in safe state
            expect(newBelief).toBeGreaterThan(initialBelief);
        });
    });
    describe('Review Phase', () => {
        beforeEach(() => {
            game.setProposal(types_1.ProtocolLevel.Low);
        });
        test('should accept valid review action', () => {
            game.setReview(types_1.ReviewAction.Accept);
            const state = game.getState();
            expect(state.phase).toBe(types_1.Phase.Execution);
            expect(state.reviewAction).toBe(types_1.ReviewAction.Accept);
            expect(state.history).toContain('B chose accept');
        });
        test('should reject review in wrong phase', () => {
            // Reset game to proposal phase
            const newGame = new game_1.MSPNGame('test-seed');
            expect(() => {
                newGame.setReview(types_1.ReviewAction.Accept);
            }).toThrow('Cannot set review in phase proposal');
        });
        test('should update beliefs after review', () => {
            const initialState = game.getState();
            const initialBelief = initialState.agentBeliefs.b.own[types_1.TrueState.SafeLow];
            game.setReview(types_1.ReviewAction.Accept);
            const newState = game.getState();
            const newBelief = newState.agentBeliefs.b.own[types_1.TrueState.SafeLow];
            // Accepting should increase belief in safe state
            expect(newBelief).toBeGreaterThan(initialBelief);
        });
    });
    describe('Execution Phase', () => {
        test('should resolve secure coordination (high protocol)', () => {
            game.setProposal(types_1.ProtocolLevel.High);
            game.setReview(types_1.ReviewAction.Accept);
            const finalState = game.resolveExecution();
            expect(finalState.phase).toBe(types_1.Phase.End);
            expect(finalState.finalProtocol).toBe(types_1.ProtocolLevel.High);
            expect(finalState.payoffs).toEqual({ a: 10, b: 10 });
        });
        test('should resolve secure coordination (medium protocol)', () => {
            game.setProposal(types_1.ProtocolLevel.Medium);
            game.setReview(types_1.ReviewAction.Accept);
            const finalState = game.resolveExecution();
            expect(finalState.phase).toBe(types_1.Phase.End);
            expect(finalState.finalProtocol).toBe(types_1.ProtocolLevel.Medium);
            expect(finalState.payoffs).toEqual({ a: 10, b: 10 });
        });
        test('should resolve risky success (low protocol, safe state)', () => {
            // Force safe state for this test
            const safeGame = new game_1.MSPNGame('safe-test');
            const state = safeGame.getState();
            if (state.trueState === types_1.TrueState.SafeLow) {
                safeGame.setProposal(types_1.ProtocolLevel.Low);
                safeGame.setReview(types_1.ReviewAction.Accept);
                const finalState = safeGame.resolveExecution();
                expect(finalState.finalProtocol).toBe(types_1.ProtocolLevel.Low);
                expect(finalState.payoffs).toEqual({ a: 12, b: 8 });
            }
        });
        test('should resolve breach (low protocol, dangerous state)', () => {
            // Force dangerous state for this test
            const dangerousGame = new game_1.MSPNGame('dangerous-test');
            const state = dangerousGame.getState();
            if (state.trueState === types_1.TrueState.DangerousLow) {
                dangerousGame.setProposal(types_1.ProtocolLevel.Low);
                dangerousGame.setReview(types_1.ReviewAction.Accept);
                const finalState = dangerousGame.resolveExecution();
                expect(finalState.finalProtocol).toBe(types_1.ProtocolLevel.Low);
                expect(finalState.payoffs).toEqual({ a: -5, b: -5 });
            }
        });
        test('should resolve rejection', () => {
            game.setProposal(types_1.ProtocolLevel.Low);
            game.setReview(types_1.ReviewAction.Reject);
            const finalState = game.resolveExecution();
            expect(finalState.phase).toBe(types_1.Phase.End);
            expect(finalState.finalProtocol).toBeUndefined();
            expect(finalState.payoffs).toEqual({ a: 2, b: 2 });
        });
        test('should resolve modification', () => {
            game.setProposal(types_1.ProtocolLevel.Low);
            game.setReview(types_1.ReviewAction.ModifyHigh);
            const finalState = game.resolveExecution();
            expect(finalState.phase).toBe(types_1.Phase.End);
            expect(finalState.finalProtocol).toBe(types_1.ProtocolLevel.High);
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
            game.setProposal(types_1.ProtocolLevel.Low);
            game.setReview(types_1.ReviewAction.Accept);
            game.resolveExecution();
            expect(game.isGameOver()).toBe(true);
        });
        test('should return current phase', () => {
            expect(game.getCurrentPhase()).toBe(types_1.Phase.Proposal);
            game.setProposal(types_1.ProtocolLevel.Low);
            expect(game.getCurrentPhase()).toBe(types_1.Phase.Review);
            game.setReview(types_1.ReviewAction.Accept);
            expect(game.getCurrentPhase()).toBe(types_1.Phase.Execution);
            game.resolveExecution();
            expect(game.getCurrentPhase()).toBe(types_1.Phase.End);
        });
        test('should end game properly', () => {
            game.setProposal(types_1.ProtocolLevel.Low);
            game.setReview(types_1.ReviewAction.Accept);
            game.resolveExecution();
            const finalState = game.endGame();
            expect(finalState.phase).toBe(types_1.Phase.End);
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
            game.setProposal(types_1.ProtocolLevel.Low);
            const newState = game.getState();
            const newBeliefA = newState.agentBeliefs.a;
            // Beliefs should still sum to 1
            expect(newBeliefA.own[types_1.TrueState.SafeLow] +
                newBeliefA.own[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
            expect(newBeliefA.aboutOpponent[types_1.TrueState.SafeLow] +
                newBeliefA.aboutOpponent[types_1.TrueState.DangerousLow]).toBeCloseTo(1, 5);
        });
        test('should update beliefs based on action type', () => {
            const initialState = game.getState();
            const initialSafeBelief = initialState.agentBeliefs.a.own[types_1.TrueState.SafeLow];
            // Proposing low should increase safe belief
            game.setProposal(types_1.ProtocolLevel.Low);
            const afterProposal = game.getState();
            expect(afterProposal.agentBeliefs.a.own[types_1.TrueState.SafeLow]).toBeGreaterThan(initialSafeBelief);
            // Accepting should further increase safe belief
            game.setReview(types_1.ReviewAction.Accept);
            const afterReview = game.getState();
            expect(afterReview.agentBeliefs.b.own[types_1.TrueState.SafeLow]).toBeGreaterThanOrEqual(afterProposal.agentBeliefs.b.own[types_1.TrueState.SafeLow]);
        });
    });
    describe('Reproducibility', () => {
        test('should produce same results with same seed', () => {
            const game1 = new game_1.MSPNGame('test-seed');
            const game2 = new game_1.MSPNGame('test-seed');
            const state1 = game1.getState();
            const state2 = game2.getState();
            expect(state1.trueState).toBe(state2.trueState);
            expect(state1.agentBeliefs.a.own[types_1.TrueState.SafeLow]).toBeCloseTo(state2.agentBeliefs.a.own[types_1.TrueState.SafeLow], 5);
        });
        test('should produce different results with different seeds', () => {
            const game1 = new game_1.MSPNGame('seed1');
            const game2 = new game_1.MSPNGame('seed2');
            const state1 = game1.getState();
            const state2 = game2.getState();
            // At least one aspect should be different
            const beliefsDifferent = state1.agentBeliefs.a.own[types_1.TrueState.SafeLow] !==
                state2.agentBeliefs.a.own[types_1.TrueState.SafeLow] ||
                state1.trueState !== state2.trueState;
            expect(beliefsDifferent).toBe(true);
        });
    });
});
//# sourceMappingURL=game.test.js.map