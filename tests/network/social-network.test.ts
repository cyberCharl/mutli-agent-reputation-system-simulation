import { SocialNetwork } from '../../src/network/social-network';
import { NetworkConfig } from '../../src/types';

const config: NetworkConfig = {
  enabled: true,
  blackListMaxSize: 2,
  observationInterval: 1,
  initialConnectivity: 0,
};

describe('SocialNetwork', () => {
  test('adds/removes role-specific edges and tracks incoming/outgoing', () => {
    const network = new SocialNetwork(config);

    network.addEdge('a', 'b', 'investor', 1);
    network.addEdge('a', 'c', 'investor', 2);
    network.addEdge('b', 'a', 'trustee', 3);

    expect(network.hasEdge('a', 'b', 'investor')).toBe(true);
    expect(network.getConnections('a', 'investor').sort()).toEqual(['b', 'c']);
    expect(network.getIncomingConnections('a', 'trustee')).toEqual(['b']);

    network.removeEdge('a', 'b', 'investor');
    expect(network.hasEdge('a', 'b', 'investor')).toBe(false);
  });

  test('enforces blacklist and max size ordering', () => {
    const network = new SocialNetwork(config);

    network.addToBlackList('a', 'x');
    network.addToBlackList('a', 'y');
    network.addToBlackList('a', 'z');

    expect(network.getBlackList('a')).toEqual(['y', 'z']);
    expect(network.canConnect('a', 'z')).toBe(false);

    network.addEdge('a', 'z', 'investor', 1);
    expect(network.hasEdge('a', 'z', 'investor')).toBe(false);

    network.removeFromBlackList('a', 'z');
    expect(network.canConnect('a', 'z')).toBe(true);

    network.addEdge('a', 'z', 'investor', 2);
    expect(network.hasEdge('a', 'z', 'investor')).toBe(true);
  });

  test('exports/imports edges and blacklist data', () => {
    const network = new SocialNetwork(config);
    network.addEdge('a', 'b', 'investor', 10);
    network.addEdge('b', 'c', 'reviewer', 12);
    network.addToBlackList('a', 'x');
    network.addToBlackList('a', 'y');
    network.addToBlackList('a', 'z');

    const exported = network.export();

    const restored = new SocialNetwork(config);
    restored.import(exported);

    expect(
      restored
        .getEdges()
        .map((e) => `${e.role}:${e.from}->${e.to}`)
        .sort()
    ).toEqual(['investor:a->b', 'reviewer:b->c']);
    expect(restored.getBlackList('a')).toEqual(['y', 'z']);
    expect(restored.getAllConnections('a').investor).toEqual(['b']);
  });
});
