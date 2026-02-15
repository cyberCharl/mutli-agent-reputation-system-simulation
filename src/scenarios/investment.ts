import { Persona } from '../agent';
import { AgentRole, ScenarioResult } from '../types';
import { Scenario, ScenarioContext } from './scenario';

const RETURN_OPTIONS = [0, 25, 75, 100, 150] as const;

export class InvestmentScenario implements Scenario {
  name = 'investment';
  roles: AgentRole[] = ['investor', 'trustee'];

  async pair(
    agents: Persona[],
    _network: ScenarioContext['network'],
    _config: ScenarioContext['config'],
    step: number
  ): Promise<Array<[Persona, Persona]>> {
    const shuffled = [...agents].sort((a, b) => {
      const left = (a.state.id + step * 17) % 11;
      const right = (b.state.id + step * 17) % 11;
      return left - right;
    });

    const midpoint = Math.floor(shuffled.length / 2);
    const investors = shuffled.slice(0, midpoint);
    const trustees = shuffled.slice(midpoint);

    investors.forEach((agent) => agent.setRole('investor'));
    trustees.forEach((agent) => agent.setRole('trustee'));

    const pairs: Array<[Persona, Persona]> = [];
    const length = Math.min(investors.length, trustees.length);
    for (let i = 0; i < length; i += 1) {
      pairs.push([investors[i], trustees[i]]);
    }
    return pairs;
  }

  async execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [investor, trustee] = pair;
    const trust = context.reputationDb.getAggregateScore(
      investor.getId(),
      trustee.getId()
    );

    const acceptDecision = context.decisionProvider?.decideInvestmentAccept
      ? await context.decisionProvider.decideInvestmentAccept({
          investor,
          trustee,
          step: context.step,
        })
      : {
          accept: trust > -0.5,
          reasoning:
            'Heuristic acceptance based on aggregate reputation score.',
        };

    if (!acceptDecision.accept) {
      return {
        pairId: `${investor.state.name}-${trustee.state.name}`,
        agents: [investor.state.name, trustee.state.name],
        roles: ['investor', 'trustee'],
        actions: { accept: 'false' },
        payoffs: { [investor.state.name]: 0, [trustee.state.name]: 0 },
        history: [
          `${investor.state.name} refused to invest with ${trustee.state.name}`,
        ],
        metadata: { acceptDecision },
      };
    }

    const amountDecision = context.decisionProvider?.decideInvestmentAmount
      ? await context.decisionProvider.decideInvestmentAmount({
          investor,
          trustee,
          step: context.step,
        })
      : {
          amount: Math.max(1, Math.min(10, Math.round((trust + 1) * 4 + 2))),
          reasoning: 'Heuristic amount based on trust score.',
        };
    const amount = Math.max(1, Math.min(10, amountDecision.amount));
    const trusteeReceives = amount * 3;

    const returnDecision = context.decisionProvider?.decideInvestmentReturn
      ? await context.decisionProvider.decideInvestmentReturn({
          trustee,
          investor,
          amount,
          received: trusteeReceives,
          step: context.step,
        })
      : {
          percentage: this.pickReturnByTrust(
            context.reputationDb.getAggregateScore(
              trustee.getId(),
              investor.getId()
            )
          ),
          reasoning: 'Heuristic return based on reciprocal trust score.',
        };

    const percentage = Number(returnDecision.percentage);
    const returned = (trusteeReceives * percentage) / 100;

    return {
      pairId: `${investor.state.name}-${trustee.state.name}`,
      agents: [investor.state.name, trustee.state.name],
      roles: ['investor', 'trustee'],
      actions: {
        accept: 'true',
        amount: String(amount),
        returnPercentage: String(percentage),
      },
      payoffs: {
        [investor.state.name]: returned - amount,
        [trustee.state.name]: trusteeReceives - returned,
      },
      history: [
        `${investor.state.name} invested ${amount}`,
        `${trustee.state.name} returned ${percentage}%`,
      ],
      metadata: {
        amountDecision,
        returnDecision,
      },
    };
  }

  async updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void> {
    const [investor, trustee] = pair;
    const accepted = result.actions.accept === 'true';
    const amount = Number(result.actions.amount ?? '0');
    const returnPct = Number(result.actions.returnPercentage ?? '0');

    context.reputationUpdater.applyDelta({
      observerId: investor.getId(),
      target: {
        id: trustee.getId(),
        name: trustee.state.name,
        role: 'trustee',
      },
      delta: accepted
        ? returnPct >= 100
          ? { returnSuccesses: 1 }
          : { returnIssues: 1 }
        : { trusteeFailures: 0 },
      narrative: `Investment interaction with ${trustee.state.name}`,
      reason: `Trustee return percentage ${returnPct}`,
      step: context.step,
    });

    context.reputationUpdater.applyDelta({
      observerId: trustee.getId(),
      target: {
        id: investor.getId(),
        name: investor.state.name,
        role: 'investor',
      },
      delta: accepted
        ? amount > 0
          ? {
              investorSuccesses: returnPct >= 75 ? 1 : 0,
              investmentFailures: returnPct < 75 ? 1 : 0,
            }
          : {}
        : { investmentFailures: 1 },
      narrative: `Investment interaction with ${investor.state.name}`,
      reason: accepted ? 'Investment was accepted' : 'Investment was refused',
      step: context.step,
    });
  }

  shouldTriggerGossip(result: ScenarioResult): boolean {
    return (
      result.actions.accept === 'true' &&
      Number(result.actions.returnPercentage ?? '0') < 75
    );
  }

  private pickReturnByTrust(score: number): '0' | '25' | '75' | '100' | '150' {
    if (score > 0.7) {
      return '150';
    }
    if (score > 0.35) {
      return '100';
    }
    if (score > 0) {
      return '75';
    }
    if (score > -0.4) {
      return '25';
    }
    const index = Math.floor((score + 1) * (RETURN_OPTIONS.length / 2));
    return String(RETURN_OPTIONS[Math.max(0, Math.min(1, index))]) as
      | '0'
      | '25'
      | '75'
      | '100'
      | '150';
  }
}
