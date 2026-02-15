import { Persona } from '../agent';
import { AgentRole, ScenarioResult } from '../types';
import { Scenario, ScenarioContext } from './scenario';

type SignAction = 'sign_up' | 'wait';

export class SignUpScenario implements Scenario {
  name = 'sign-up';
  roles: AgentRole[] = ['resident'];

  async pair(
    agents: Persona[],
    _network: ScenarioContext['network'],
    _config: ScenarioContext['config'],
    _step: number
  ): Promise<Array<[Persona, Persona]>> {
    const residents = [...agents];
    residents.forEach((resident) => resident.setRole('resident'));

    const pairs: Array<[Persona, Persona]> = [];
    for (let i = 0; i + 1 < residents.length; i += 2) {
      pairs.push([residents[i], residents[i + 1]]);
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
    const [payoffA, payoffB] = this.payoff(actionA, actionB);

    return {
      pairId: `${a.state.name}-${b.state.name}`,
      agents: [a.state.name, b.state.name],
      roles: ['resident', 'resident'],
      actions: {
        [a.state.name]: actionA,
        [b.state.name]: actionB,
      },
      payoffs: {
        [a.state.name]: payoffA,
        [b.state.name]: payoffB,
      },
      history: [
        `${a.state.name} chose ${actionA}`,
        `${b.state.name} chose ${actionB}`,
      ],
      metadata: {},
    };
  }

  async updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void> {
    const [a, b] = pair;
    const actionA = result.actions[a.state.name] as SignAction;
    const actionB = result.actions[b.state.name] as SignAction;

    context.reputationUpdater.applyDelta({
      observerId: a.getId(),
      target: { id: b.getId(), name: b.state.name, role: 'resident' },
      delta:
        actionB === 'sign_up'
          ? { investorSuccesses: 1 }
          : { investmentFailures: 1 },
      narrative: `Sign-up participation from ${b.state.name}`,
      reason: 'Sign-up encounter',
      step: context.step,
    });

    context.reputationUpdater.applyDelta({
      observerId: b.getId(),
      target: { id: a.getId(), name: a.state.name, role: 'resident' },
      delta:
        actionA === 'sign_up'
          ? { investorSuccesses: 1 }
          : { investmentFailures: 1 },
      narrative: `Sign-up participation from ${a.state.name}`,
      reason: 'Sign-up encounter',
      step: context.step,
    });
  }

  shouldTriggerGossip(result: ScenarioResult): boolean {
    return Object.values(result.actions).includes('wait');
  }

  private async decideAction(
    self: Persona,
    partner: Persona,
    context: ScenarioContext
  ): Promise<SignAction> {
    if (context.decisionProvider?.decideSignUpAction) {
      const response = await context.decisionProvider.decideSignUpAction({
        self,
        partner,
        step: context.step,
      });
      return response.action;
    }

    const score = context.reputationDb.getAggregateScore(
      self.getId(),
      partner.getId()
    );
    return score >= -0.2 ? 'sign_up' : 'wait';
  }

  private payoff(a: SignAction, b: SignAction): [number, number] {
    if (a === 'sign_up' && b === 'sign_up') {
      return [2, 2];
    }
    if (a === 'sign_up' && b === 'wait') {
      return [1, 0];
    }
    if (a === 'wait' && b === 'sign_up') {
      return [0, 1];
    }
    return [0, 0];
  }
}
