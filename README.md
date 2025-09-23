# MSPN Simulation: Misaligned Secure Protocol Negotiation

A TypeScript simulation of the Misaligned Secure Protocol Negotiation (MSPN) hypergame for researching multi-agent security with LLM agents, focusing on reputation systems via A/B testing.

## Overview

This project implements a full simulation of the MSPN hypergame where 2 LLM agents (A: Proposer, B: Reviewer) negotiate a secure protocol under nested beliefs and perceptual misalignments. It integrates a karma-like reputation system tied to base models and supports A/B testing between baseline (no reputation) and with-reputation scenarios.

## Game Rules

- **Players**: 2 agents (A: Proposer, B: Reviewer) with asymmetric roles
- **Objective**: Negotiate a protocol for secure data sharing
- **Phases**: Sequential, 3 rounds max with early end on agreement/reject
  1. **Proposal**: A proposes ProtocolLevel ('low' | 'medium' | 'high')
  2. **Review**: B chooses ReviewAction ('accept' | 'modify-low' | 'modify-medium' | 'modify-high' | 'reject')
  3. **Execution**: Resolve final protocol and payoffs

### Hidden Elements & Nested Beliefs

- **True State**: 'risk-low-safe' or 'risk-low-dangerous' (randomized 50/50)
- **Beliefs**: Each agent has nested beliefs about the true state and opponent's beliefs
- **Updates**: Beliefs update via simple Bayes after actions

### Payoffs

| Outcome             | A Payoff | B Payoff | Condition                     |
| ------------------- | -------- | -------- | ----------------------------- |
| Secure Coordination | 10       | 10       | Agreed high/medium, any state |
| Risky Success       | 12       | 8        | Agreed low, safe state        |
| Breach              | -5       | -5       | Agreed low, dangerous state   |
| Misalignment/Reject | 2        | 2        | Reject or incompatible        |

### Reputation System

- Post-episode "inspection" of history
- Karma 0-100, persistent per model ID
- Consequences: If karma <30, block risky actions or penalize payoffs by 50%

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd mspn-simulation
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp env.example .env
# Edit .env and add your OpenAI API key
```

### Configuration

The project uses the following configuration files:

- `tsconfig.json`: TypeScript configuration with strict mode
- `.prettierrc.json`: Code formatting (80 char width)
- `jest.config.js`: Test configuration

## Usage

### Running Simulations

1. **Basic A/B Test** (uses mock agents if no API key):

```bash
npm run dev
```

2. **Custom Parameters**:

```bash
npm run dev [numEpisodes] [seed]
# Example: npm run dev 200 test-seed-123
```

3. **With OpenAI API** (set OPENAI_API_KEY in .env):

```bash
npm run dev 100
```

### Available Scripts

- `npm run dev`: Run the main simulator
- `npm test`: Run Jest unit tests
- `npm run build`: Compile TypeScript to JavaScript
- `npm run format`: Format code with Prettier
- `npm run lint`: Check code formatting

### Output

The simulator generates:

- Console logs with progress and results
- `results.json`: Detailed results including metrics and episode data

### Metrics Explained

- **Cooperation Rate**: % of episodes with secure high/medium agreements
- **Breach Rate**: % of episodes with negative payoffs (breaches)
- **Average Payoffs**: Mean payoffs for agents A and B
- **Reputation Stats**: Karma distribution and consequences

## Project Structure

```
src/
├── types.ts          # Type definitions and interfaces
├── prompts.ts        # LLM prompt templates
├── game.ts           # Core game logic (MSPNGame class)
├── agent.ts          # LLM integration and mock agents
├── reputation.ts     # Karma system and consequences
└── simulator.ts      # Episode runner and A/B testing

tests/
└── game.test.ts      # Jest unit tests

Configuration files:
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── .prettierrc.json  # Code formatting
└── jest.config.js    # Test configuration
```

## Development

### Adding New Features

1. **New Agent Types**: Extend the `Agent` class in `src/agent.ts`
2. **New Game Rules**: Modify `MSPNGame` class in `src/game.ts`
3. **New Reputation Rules**: Update `ReputationSystem` in `src/reputation.ts`

### Testing

Run the test suite:

```bash
npm test
```

The tests cover:

- Game state management
- Belief updates
- Payoff calculations
- Reproducibility with seeds

### Code Style

The project uses:

- TypeScript strict mode
- Prettier formatting (80 char width)
- Comprehensive type safety
- Error handling with retries

## Research Applications

This simulator is designed for:

- Multi-agent security research
- Reputation system effectiveness studies
- LLM behavior analysis in strategic games
- A/B testing of intervention mechanisms

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation as needed
4. Ensure all tests pass before submitting

## License

MIT License - see LICENSE file for details.
