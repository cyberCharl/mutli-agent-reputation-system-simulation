import { Persona } from '../agent';
import { MSPNGame } from '../game';
import {
  AgentRole,
  ProtocolLevel,
  ReviewAction,
  ScenarioResult,
  TrueState,
} from '../types';
import { Scenario, ScenarioContext } from './scenario';

export class MSPNNegotiationScenario implements Scenario {
  name = 'mspn-negotiation';
  roles: AgentRole[] = ['proposer', 'reviewer'];

  async pair(
    agents: Persona[],
    _network: ScenarioContext['network'],
    _config: ScenarioContext['config'],
    _step: number
  ): Promise<Array<[Persona, Persona]>> {
    const pairs: Array<[Persona, Persona]> = [];
    for (let i = 0; i + 1 < agents.length; i += 2) {
      const proposer = agents[i];
      const reviewer = agents[i + 1];
      proposer.setRole('proposer');
      reviewer.setRole('reviewer');
      pairs.push([proposer, reviewer]);
    }
    return pairs;
  }

  async execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [proposer, reviewer] = pair;
    const game = new MSPNGame(
      `mspn-${context.step}-${proposer.state.name}-${reviewer.state.name}`
    );

    const maxRounds = Math.max(1, Math.min(5, context.config.maxRounds || 3));
    for (let round = 0; round < maxRounds; round += 1) {
      const proposalState = game.getState();
      const proposal = (await proposer.decide(
        'propose',
        proposalState.agentBeliefs.a,
        proposalState.history
      )) as ProtocolLevel;
      game.setProposal(proposal);

      const reviewState = game.getState();
      const review = (await reviewer.decide(
        'review',
        reviewState.agentBeliefs.b,
        reviewState.history,
        reviewState.proposal
      )) as ReviewAction;
      game.setReview(review);

      if (game.isAgreement() || round === maxRounds - 1) {
        break;
      }
      game.resetForNewRound();
    }

    const finalState = game.resolveExecution();
    const finalProtocol = finalState.finalProtocol ?? ProtocolLevel.Medium;
    const payoffs = finalState.payoffs ?? { a: 0, b: 0 };

    return {
      pairId: `${proposer.state.name}-${reviewer.state.name}`,
      agents: [proposer.state.name, reviewer.state.name],
      roles: ['proposer', 'reviewer'],
      actions: {
        protocol: finalProtocol,
        reviewAction: finalState.reviewAction ?? ReviewAction.Reject,
      },
      payoffs: {
        [proposer.state.name]: payoffs.a,
        [reviewer.state.name]: payoffs.b,
      },
      history: finalState.history,
      metadata: {
        trueState: finalState.trueState,
      },
    };
  }

  async updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void> {
    const [proposer, reviewer] = pair;
    const trueState = result.metadata.trueState as TrueState | undefined;
    const protocol = result.actions.protocol as ProtocolLevel | undefined;
    const reviewAction = result.actions.reviewAction as
      | ReviewAction
      | undefined;

    const proposerDelta = {
      investorSuccesses:
        protocol === ProtocolLevel.Low && trueState === TrueState.SafeLow
          ? 1
          : protocol === ProtocolLevel.Low &&
              trueState === TrueState.DangerousLow
            ? 0
            : 0.5,
      investmentFailures:
        protocol === ProtocolLevel.Low && trueState === TrueState.DangerousLow
          ? 1
          : 0,
    };

    const reviewerDelta = {
      returnSuccesses:
        reviewAction === ReviewAction.Accept &&
        protocol === ProtocolLevel.Low &&
        trueState === TrueState.SafeLow
          ? 1
          : 0,
      returnIssues:
        reviewAction === ReviewAction.Accept &&
        protocol === ProtocolLevel.Low &&
        trueState === TrueState.DangerousLow
          ? 1
          : 0,
    };

    context.reputationUpdater.applyDelta({
      observerId: proposer.getId(),
      target: {
        id: reviewer.getId(),
        name: reviewer.state.name,
        role: 'reviewer',
      },
      delta: reviewerDelta,
      narrative: `Observed MSPN review behavior by ${reviewer.state.name}`,
      reason: 'MSPN interaction outcome',
      step: context.step,
    });

    context.reputationUpdater.applyDelta({
      observerId: reviewer.getId(),
      target: {
        id: proposer.getId(),
        name: proposer.state.name,
        role: 'proposer',
      },
      delta: proposerDelta,
      narrative: `Observed MSPN proposal behavior by ${proposer.state.name}`,
      reason: 'MSPN interaction outcome',
      step: context.step,
    });
  }

  shouldTriggerGossip(result: ScenarioResult): boolean {
    const values = Object.values(result.payoffs);
    return values.some((value) => value < 0);
  }
}
