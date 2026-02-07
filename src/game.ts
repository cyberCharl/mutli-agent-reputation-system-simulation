import seedrandom from 'seedrandom';
import {
  GameState,
  Phase,
  ProtocolLevel,
  ReviewAction,
  TrueState,
  NestedBelief,
  GameConfig,
} from './types';

export class MSPNGame {
  private state: GameState;
  private rng: seedrandom.PRNG;
  private config: GameConfig;

  constructor(seed?: string, config?: Partial<GameConfig>) {
    this.rng = seedrandom(seed || 'default');
    this.config = {
      maxRounds: 3,
      beliefUpdateStrength: { proposal: 0.2, review: 0.15 },
      payoffNoise: 1,
      initialBeliefAlignment: 0.7,
      ...config,
    };

    this.state = this.initializeGame();
  }

  private initializeGame(): GameState {
    // Randomize true state 50/50
    const trueState =
      this.rng() < 0.5 ? TrueState.SafeLow : TrueState.DangerousLow;

    // Initialize beliefs with noisy alignment to true state
    const alignment = this.config.initialBeliefAlignment;
    const noise = (this.rng() - 0.5) * 0.2; // ±0.1 noise

    const safeProb =
      trueState === TrueState.SafeLow
        ? alignment + noise
        : 1 - alignment + noise;

    const safeProbClamped = Math.max(0.1, Math.min(0.9, safeProb));
    const dangerousProb = 1 - safeProbClamped;

    const initialBelief: NestedBelief = {
      own: {
        [TrueState.SafeLow]: safeProbClamped,
        [TrueState.DangerousLow]: dangerousProb,
      },
      aboutOpponent: {
        [TrueState.SafeLow]: safeProbClamped + (this.rng() - 0.5) * 0.1,
        [TrueState.DangerousLow]:
          1 - (safeProbClamped + (this.rng() - 0.5) * 0.1),
      },
    };

    // Normalize opponent belief
    const oppSafe = Math.max(
      0.1,
      Math.min(0.9, initialBelief.aboutOpponent[TrueState.SafeLow])
    );
    initialBelief.aboutOpponent[TrueState.SafeLow] = oppSafe;
    initialBelief.aboutOpponent[TrueState.DangerousLow] = 1 - oppSafe;

    return {
      trueState,
      phase: Phase.Proposal,
      agentBeliefs: { a: { ...initialBelief }, b: { ...initialBelief } },
      history: [],
      payoffs: null,
    };
  }

  public getState(): GameState {
    return { ...this.state };
  }

  public setProposal(proposal: ProtocolLevel): void {
    if (this.state.phase !== Phase.Proposal) {
      throw new Error(`Cannot set proposal in phase ${this.state.phase}`);
    }

    this.state = {
      ...this.state,
      phase: Phase.Review,
      proposal,
      history: [...this.state.history, `A proposed ${proposal}`],
    };

    // Update beliefs based on proposal
    this.updateBeliefs('A', proposal, 'proposal');
    // Observer (B) updates beliefs from watching A's action
    this.updateBeliefsFromObservation('B', proposal, 'proposal');
  }

  public setReview(reviewAction: ReviewAction): void {
    if (this.state.phase !== Phase.Review) {
      throw new Error(`Cannot set review in phase ${this.state.phase}`);
    }

    this.state = {
      ...this.state,
      phase: Phase.Execution,
      reviewAction,
      history: [...this.state.history, `B chose ${reviewAction}`],
    };

    // Update beliefs based on review
    this.updateBeliefs('B', reviewAction, 'review');
    // Observer (A) updates beliefs from watching B's action
    this.updateBeliefsFromObservation('A', reviewAction, 'review');
  }

  public resolveExecution(): GameState {
    if (this.state.phase !== Phase.Execution) {
      throw new Error(`Cannot resolve execution in phase ${this.state.phase}`);
    }

    const { proposal, reviewAction, trueState } = this.state;
    let finalProtocol: ProtocolLevel | undefined;
    let payoffs: { a: number; b: number };

    if (reviewAction === ReviewAction.Reject) {
      // Reject ends with low payoffs
      payoffs = { a: 2, b: 2 };
    } else {
      // Determine final protocol
      if (reviewAction === ReviewAction.Accept) {
        finalProtocol = proposal!;
      } else {
        // Extract protocol from modify action
        if (reviewAction === ReviewAction.ModifyLow) {
          finalProtocol = ProtocolLevel.Low;
        } else if (reviewAction === ReviewAction.ModifyMedium) {
          finalProtocol = ProtocolLevel.Medium;
        } else if (reviewAction === ReviewAction.ModifyHigh) {
          finalProtocol = ProtocolLevel.High;
        } else {
          // Fallback (shouldn't happen)
          finalProtocol = ProtocolLevel.Medium;
        }
      }

      // Calculate payoffs based on final protocol and true state
      payoffs = this.calculatePayoffs(finalProtocol, trueState);
    }

    // Add noise to payoffs
    const noiseA = (this.rng() - 0.5) * 2 * this.config.payoffNoise;
    const noiseB = (this.rng() - 0.5) * 2 * this.config.payoffNoise;

    payoffs = {
      a: Math.round(payoffs.a + noiseA),
      b: Math.round(payoffs.b + noiseB),
    };

    this.state = {
      ...this.state,
      phase: Phase.End,
      finalProtocol,
      payoffs,
      history: [
        ...this.state.history,
        `Final protocol: ${finalProtocol || 'rejected'}, Payoffs: A=${payoffs.a}, B=${payoffs.b}`,
      ],
    };

    return this.getState();
  }

  private calculatePayoffs(
    protocol: ProtocolLevel,
    trueState: TrueState
  ): { a: number; b: number } {
    if (protocol === ProtocolLevel.High || protocol === ProtocolLevel.Medium) {
      // Secure coordination - no breach possible
      return { a: 10, b: 10 };
    } else if (protocol === ProtocolLevel.Low) {
      if (trueState === TrueState.SafeLow) {
        // Risky success
        return { a: 12, b: 8 };
      } else {
        // Breach
        return { a: -5, b: -5 };
      }
    }

    // Fallback (shouldn't happen)
    return { a: 2, b: 2 };
  }

  private updateBeliefs(
    agentId: 'A' | 'B',
    action: ProtocolLevel | ReviewAction,
    type: 'proposal' | 'review'
  ): void {
    const strength =
      type === 'proposal'
        ? this.config.beliefUpdateStrength.proposal
        : this.config.beliefUpdateStrength.review;

    const agentBelief =
      this.state.agentBeliefs[agentId.toLowerCase() as 'a' | 'b'];
    const updatedBelief = { ...agentBelief };

    // Update own belief based on action
    if (type === 'proposal') {
      const proposal = action as ProtocolLevel;
      if (proposal === ProtocolLevel.Low) {
        // Proposing low suggests belief in safe state
        updatedBelief.own[TrueState.SafeLow] += strength;
        updatedBelief.own[TrueState.DangerousLow] -= strength;
      } else if (proposal === ProtocolLevel.High) {
        // Proposing high suggests belief in dangerous state
        updatedBelief.own[TrueState.SafeLow] -= strength / 2;
        updatedBelief.own[TrueState.DangerousLow] += strength / 2;
      }
    } else {
      const review = action as ReviewAction;
      if (review === ReviewAction.Accept) {
        // Accepting suggests belief in safe state
        updatedBelief.own[TrueState.SafeLow] += strength;
        updatedBelief.own[TrueState.DangerousLow] -= strength;
      } else if (review === ReviewAction.Reject) {
        // Rejecting suggests belief in dangerous state
        updatedBelief.own[TrueState.SafeLow] -= strength;
        updatedBelief.own[TrueState.DangerousLow] += strength;
      }
    }

    // Normalize probabilities
    this.normalizeBelief(updatedBelief.own);
    this.normalizeBelief(updatedBelief.aboutOpponent);

    // Update state
    this.state = {
      ...this.state,
      agentBeliefs: {
        ...this.state.agentBeliefs,
        [agentId.toLowerCase()]: updatedBelief,
      },
    };
  }

  /**
   * Update an observing agent's beliefs based on the opponent's revealed action.
   * When the observer sees the opponent propose Low, the observer infers the
   * opponent believes the state is safe — updating the observer's aboutOpponent belief.
   */
  public updateBeliefsFromObservation(
    observerId: 'A' | 'B',
    observedAction: ProtocolLevel | ReviewAction,
    type: 'proposal' | 'review'
  ): void {
    const strength =
      type === 'proposal'
        ? this.config.beliefUpdateStrength.proposal
        : this.config.beliefUpdateStrength.review;

    const observerKey = observerId.toLowerCase() as 'a' | 'b';
    const observerBelief = this.state.agentBeliefs[observerKey];
    const updatedBelief = {
      own: { ...observerBelief.own },
      aboutOpponent: { ...observerBelief.aboutOpponent },
    };

    if (type === 'proposal') {
      const proposal = observedAction as ProtocolLevel;
      if (proposal === ProtocolLevel.Low) {
        // Opponent proposed low → opponent likely believes state is safe
        updatedBelief.aboutOpponent[TrueState.SafeLow] += strength;
        updatedBelief.aboutOpponent[TrueState.DangerousLow] -= strength;
      } else if (proposal === ProtocolLevel.High) {
        // Opponent proposed high → opponent likely believes state is dangerous
        updatedBelief.aboutOpponent[TrueState.SafeLow] -= strength / 2;
        updatedBelief.aboutOpponent[TrueState.DangerousLow] += strength / 2;
      }
    } else {
      const review = observedAction as ReviewAction;
      if (review === ReviewAction.Accept) {
        // Opponent accepted → opponent likely believes state is safe
        updatedBelief.aboutOpponent[TrueState.SafeLow] += strength;
        updatedBelief.aboutOpponent[TrueState.DangerousLow] -= strength;
      } else if (review === ReviewAction.Reject) {
        // Opponent rejected → opponent likely believes state is dangerous
        updatedBelief.aboutOpponent[TrueState.SafeLow] -= strength;
        updatedBelief.aboutOpponent[TrueState.DangerousLow] += strength;
      }
    }

    this.normalizeBelief(updatedBelief.aboutOpponent);

    this.state = {
      ...this.state,
      agentBeliefs: {
        ...this.state.agentBeliefs,
        [observerKey]: updatedBelief,
      },
    };
  }

  private normalizeBelief(belief: Record<TrueState, number>): void {
    const total = belief[TrueState.SafeLow] + belief[TrueState.DangerousLow];
    if (total > 0) {
      belief[TrueState.SafeLow] = Math.max(
        0.01,
        Math.min(0.99, belief[TrueState.SafeLow] / total)
      );
      belief[TrueState.DangerousLow] = 1 - belief[TrueState.SafeLow];
    } else {
      belief[TrueState.SafeLow] = 0.5;
      belief[TrueState.DangerousLow] = 0.5;
    }
  }

  /**
   * Check if the review action agrees with the proposal (both want the same level).
   * Agreement means: accept (reviewer agrees with proposer's level), or
   * modify to the same level as the proposal.
   */
  public isAgreement(): boolean {
    const { proposal, reviewAction } = this.state;
    if (!proposal || !reviewAction) return false;

    if (reviewAction === ReviewAction.Accept) return true;
    if (reviewAction === ReviewAction.Reject) return false;

    // Check if modification matches the proposal
    const modifiedLevel =
      reviewAction === ReviewAction.ModifyLow
        ? ProtocolLevel.Low
        : reviewAction === ReviewAction.ModifyMedium
          ? ProtocolLevel.Medium
          : ProtocolLevel.High;
    return modifiedLevel === proposal;
  }

  /**
   * Reset the game to the proposal phase for a new negotiation round,
   * preserving beliefs and history but allowing a new proposal/review cycle.
   */
  public resetForNewRound(): void {
    if (this.state.phase !== Phase.Execution) {
      throw new Error(
        `Cannot reset for new round in phase ${this.state.phase}`
      );
    }

    this.state = {
      ...this.state,
      phase: Phase.Proposal,
      proposal: undefined,
      reviewAction: undefined,
      history: [
        ...this.state.history,
        '--- New negotiation round ---',
      ],
    };
  }

  public endGame(): GameState {
    if (this.state.phase !== Phase.End) {
      throw new Error(`Game not finished, current phase: ${this.state.phase}`);
    }
    return this.getState();
  }

  public isGameOver(): boolean {
    return this.state.phase === Phase.End;
  }

  public getCurrentPhase(): Phase {
    return this.state.phase;
  }
}
