import { Persona } from '../agent';
import { AgentRole, ScenarioResult } from '../types';
import { Scenario, ScenarioContext } from './scenario';

type PDAction = 'cooperate' | 'defect';

export class PrisonerDilemmaScenario implements Scenario {
  name = 'prisoner-dilemma';
  roles: AgentRole[] = ['player'];

  async pair(
    agents: Persona[],
    _network: ScenarioContext['network'],
    _config: ScenarioContext['config'],
    _step: number
  ): Promise<Array<[Persona, Persona]>> {
    const pairs: Array<[Persona, Persona]> = [];
    const players = [...agents];
    players.forEach((player) => player.setRole('player'));
    for (let i = 0; i + 1 < players.length; i += 2) {
      pairs.push([players[i], players[i + 1]]);
    }
    return pairs;
  }

  async execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [a, b] = pair;
    const actionA = await this.decideAction(a, b, context);
    const actionB = await this.decideAction(b, a, context);

    const [payoffA, payoffB] = this.computePayoff(actionA, actionB);

    return {
      pairId: `${a.state.name}-${b.state.name}`,
      agents: [a.state.name, b.state.name],
      roles: ['player', 'player'],
      actions: {
        [a.state.name]: actionA,
        [b.state.name]: actionB,
      },
      payoffs: {
        [a.state.name]: payoffA,
        [b.state.name]: payoffB,
      },
      history: [`${a.state.name}:${actionA}`, `${b.state.name}:${actionB}`],
      metadata: {},
    };
  }

  async updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void> {
    const [a, b] = pair;
    const actionA = result.actions[a.state.name] as PDAction;
    const actionB = result.actions[b.state.name] as PDAction;

    context.reputationUpdater.applyDelta({
      observerId: a.getId(),
      target: { id: b.getId(), name: b.state.name, role: 'player' },
      delta:
        actionB === 'cooperate'
          ? { investorSuccesses: 1 }
          : { trusteeFailures: 1 },
      narrative: `PD action observed: ${actionB}`,
      reason: 'Prisoner dilemma interaction',
      step: context.step,
    });

    context.reputationUpdater.applyDelta({
      observerId: b.getId(),
      target: { id: a.getId(), name: a.state.name, role: 'player' },
      delta:
        actionA === 'cooperate'
          ? { investorSuccesses: 1 }
          : { trusteeFailures: 1 },
      narrative: `PD action observed: ${actionA}`,
      reason: 'Prisoner dilemma interaction',
      step: context.step,
    });
  }

  shouldTriggerGossip(result: ScenarioResult): boolean {
    return Object.values(result.actions).includes('defect');
  }

  private async decideAction(
    self: Persona,
    opponent: Persona,
    context: ScenarioContext
  ): Promise<PDAction> {
    if (context.decisionProvider?.decidePDAction) {
      const decision = await context.decisionProvider.decidePDAction({
        self,
        opponent,
        step: context.step,
      });
      return decision.action;
    }

    const score = context.reputationDb.getAggregateScore(
      self.getId(),
      opponent.getId()
    );
    return score >= 0 ? 'cooperate' : 'defect';
  }

  private computePayoff(a: PDAction, b: PDAction): [number, number] {
    if (a === 'cooperate' && b === 'cooperate') {
      return [3, 3];
    }
    if (a === 'cooperate' && b === 'defect') {
      return [0, 5];
    }
    if (a === 'defect' && b === 'cooperate') {
      return [5, 0];
    }
    return [1, 1];
  }
}
