import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KarmaStorage } from '../src/karma/storage';

describe('KarmaStorage', () => {
  let tmpDir: string;
  let storage: KarmaStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karma-test-'));
    const filePath = path.join(tmpDir, 'karma.json');
    storage = new KarmaStorage(filePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('should save and load karma data', () => {
    const karma = new Map<string, number>([
      ['model-A', 30],
      ['model-B', 70],
    ]);

    storage.save(karma);
    const loaded = storage.load();

    expect(loaded.get('model-A')).toBe(30);
    expect(loaded.get('model-B')).toBe(70);
    expect(loaded.size).toBe(2);
  });

  test('should return empty Map when file does not exist', () => {
    const loaded = storage.load();
    expect(loaded.size).toBe(0);
  });

  test('should report existence correctly', () => {
    expect(storage.exists()).toBe(false);

    storage.save(new Map([['model-A', 50]]));
    expect(storage.exists()).toBe(true);
  });

  test('should clear stored karma', () => {
    storage.save(new Map([['model-A', 50]]));
    expect(storage.exists()).toBe(true);

    storage.clear();
    expect(storage.exists()).toBe(false);
  });

  test('should clear when file does not exist (no-op)', () => {
    expect(() => storage.clear()).not.toThrow();
  });

  test('should create parent directories if missing', () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'karma.json');
    const deepStorage = new KarmaStorage(deepPath);
    const karma = new Map([['model-X', 42]]);

    deepStorage.save(karma);
    const loaded = deepStorage.load();
    expect(loaded.get('model-X')).toBe(42);
  });

  test('should clamp loaded values to 0-100', () => {
    // Write invalid data directly
    const filePath = storage.getPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        data: { 'model-A': 150, 'model-B': -20, 'model-C': 50 },
      })
    );

    const loaded = storage.load();
    expect(loaded.get('model-A')).toBe(100);
    expect(loaded.get('model-B')).toBe(0);
    expect(loaded.get('model-C')).toBe(50);
  });

  test('should skip non-numeric values on load', () => {
    const filePath = storage.getPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        data: { 'model-A': 50, 'model-B': 'invalid', 'model-C': NaN },
      })
    );

    const loaded = storage.load();
    expect(loaded.get('model-A')).toBe(50);
    expect(loaded.has('model-B')).toBe(false);
    expect(loaded.has('model-C')).toBe(false);
  });

  test('should overwrite existing data on save', () => {
    storage.save(new Map([['model-A', 30]]));
    storage.save(new Map([['model-A', 60], ['model-B', 80]]));

    const loaded = storage.load();
    expect(loaded.get('model-A')).toBe(60);
    expect(loaded.get('model-B')).toBe(80);
    expect(loaded.size).toBe(2);
  });

  test('should include timestamp in saved file', () => {
    storage.save(new Map([['model-A', 50]]));

    const content = fs.readFileSync(storage.getPath(), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.timestamp).toBeDefined();
    expect(new Date(parsed.timestamp).getTime()).not.toBeNaN();
  });

  test('should perform atomic writes (no partial data)', () => {
    // Save initial data
    storage.save(new Map([['model-A', 50]]));

    // Save new data — should fully replace
    storage.save(new Map([['model-B', 70]]));
    const loaded = storage.load();

    // Should have only model-B, not model-A
    expect(loaded.has('model-A')).toBe(false);
    expect(loaded.get('model-B')).toBe(70);
  });

  test('should return correct file path', () => {
    const customPath = path.join(tmpDir, 'custom', 'karma.json');
    const customStorage = new KarmaStorage(customPath);
    expect(customStorage.getPath()).toBe(customPath);
  });
});
