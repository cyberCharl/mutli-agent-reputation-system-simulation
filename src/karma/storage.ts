import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface KarmaSnapshot {
  timestamp: string;
  data: Record<string, number>;
}

export class KarmaStorage {
  private filePath: string;

  constructor(filePath: string = './data/karma.json') {
    this.filePath = path.resolve(filePath);
  }

  /**
   * Save karma data to JSON file with atomic write (write to temp, then rename).
   */
  save(karma: Map<string, number>): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const snapshot: KarmaSnapshot = {
      timestamp: new Date().toISOString(),
      data: Object.fromEntries(karma),
    };

    const content = JSON.stringify(snapshot, null, 2);

    // Atomic write: write to temp file in same directory, then rename
    const tmpFile = path.join(
      dir,
      `.karma_${process.pid}_${Date.now()}.tmp`
    );
    try {
      fs.writeFileSync(tmpFile, content, 'utf-8');
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      // Clean up temp file on failure
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /**
   * Load karma data from JSON file.
   * Returns empty Map if file doesn't exist.
   */
  load(): Map<string, number> {
    if (!fs.existsSync(this.filePath)) {
      return new Map();
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    const snapshot: KarmaSnapshot = JSON.parse(content);

    // Validate and clamp values
    const result = new Map<string, number>();
    for (const [key, value] of Object.entries(snapshot.data)) {
      if (typeof value === 'number' && !isNaN(value)) {
        result.set(key, Math.max(0, Math.min(100, value)));
      }
    }

    return result;
  }

  /**
   * Check if a saved karma file exists.
   */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /**
   * Delete the stored karma file.
   */
  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  /**
   * Get the file path being used.
   */
  getPath(): string {
    return this.filePath;
  }
}
