import * as fs from 'fs';
import * as path from 'path';
import {
  TraceEpisodeSummary,
  TraceEvent,
  TraceEventPayloadMap,
  TraceEventType,
  TraceVariant,
} from '../types';
import {
  deriveHistoryFromEvents,
  parseTraceEvent,
  summarizeEpisodeTrace,
} from './events';

interface SimulationLoggerOptions {
  runDir: string;
  runId: string;
  clock?: () => Date;
  maxBufferedEvents?: number;
}

interface CreateRecorderOptions {
  variant: TraceVariant;
  episodeNumber: number;
}

interface EmitTraceEventOptions<T extends TraceEventType> {
  eventType: T;
  payload: TraceEventPayloadMap[T];
  turnId?: string;
  agentId?: string;
  parentSpanId?: string;
  causeEventIds?: string[];
}

export class EpisodeTraceRecorder {
  private readonly events: TraceEvent[] = [];
  private eventSequence = 0;

  constructor(
    private readonly logger: SimulationLogger,
    private readonly variant: TraceVariant,
    private readonly episodeNumber: number
  ) {}

  public getRunId(): string {
    return this.logger.getRunId();
  }

  public getVariant(): TraceVariant {
    return this.variant;
  }

  public getEpisodeNumber(): number {
    return this.episodeNumber;
  }

  public getEpisodeId(): string {
    return `${this.variant}-episode-${this.episodeNumber}`;
  }

  public getTraceFilePath(): string {
    return this.logger.getTraceFilePath(this.variant, this.episodeNumber);
  }

  public getSummaryFilePath(): string {
    return this.logger.getSummaryFilePath(this.variant, this.episodeNumber);
  }

  public buildTurnId(
    round: number,
    actionType: 'propose' | 'review',
    agentId: 'A' | 'B'
  ): string {
    return `${this.getEpisodeId()}-round-${round}-${actionType}-${agentId}`;
  }

  public emit<T extends TraceEventType>(
    options: EmitTraceEventOptions<T>
  ): TraceEvent {
    const event: TraceEvent = {
      eventId: `${this.getEpisodeId()}-evt-${String(this.eventSequence + 1).padStart(4, '0')}`,
      runId: this.getRunId(),
      episodeId: this.getEpisodeId(),
      turnId: options.turnId,
      agentId: options.agentId,
      parentSpanId: options.parentSpanId,
      causeEventIds: options.causeEventIds,
      eventType: options.eventType,
      timestamp: this.logger.getClock()().toISOString(),
      payload: options.payload,
    } as TraceEvent;

    const parsedEvent = parseTraceEvent(event);
    this.eventSequence += 1;
    this.events.push(parsedEvent);
    this.logger.appendEvent(this.variant, this.episodeNumber, parsedEvent);
    return parsedEvent;
  }

  public getEvents(): TraceEvent[] {
    return this.events.map((event) => ({
      ...event,
      payload: { ...event.payload },
      causeEventIds: event.causeEventIds ? [...event.causeEventIds] : undefined,
    }));
  }

  public deriveHistory(nextProposalRound?: number): string[] {
    const history = deriveHistoryFromEvents(this.events);
    if (
      nextProposalRound !== undefined &&
      nextProposalRound > 1 &&
      history.length > 0
    ) {
      const proposalCount = this.events.filter(
        (event) =>
          event.eventType === 'action_constrained' &&
          event.payload.actionType === 'propose'
      ).length;
      if (proposalCount + 1 === nextProposalRound) {
        history.push('--- New negotiation round ---');
      }
    }
    return history;
  }
}

export class SimulationLogger {
  private readonly clock: () => Date;
  private readonly maxBufferedEvents: number;
  private readonly buffers = new Map<string, string[]>();
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(private readonly options: SimulationLoggerOptions) {
    this.clock = options.clock || (() => new Date());
    this.maxBufferedEvents = options.maxBufferedEvents || 8;
  }

  public getRunId(): string {
    return this.options.runId;
  }

  public getClock(): () => Date {
    return this.clock;
  }

  public createEpisodeRecorder(
    options: CreateRecorderOptions
  ): EpisodeTraceRecorder {
    return new EpisodeTraceRecorder(this, options.variant, options.episodeNumber);
  }

  public getTraceFilePath(
    variant: TraceVariant,
    episodeNumber: number
  ): string {
    return path.join(
      this.options.runDir,
      variant,
      'traces',
      `episode_${episodeNumber}.ndjson`
    );
  }

  public getSummaryFilePath(
    variant: TraceVariant,
    episodeNumber: number
  ): string {
    return path.join(
      this.options.runDir,
      variant,
      'traces',
      `episode_${episodeNumber}.summary.json`
    );
  }

  public appendEvent(
    variant: TraceVariant,
    episodeNumber: number,
    event: TraceEvent
  ): void {
    const key = `${variant}:${episodeNumber}`;
    const buffer = this.buffers.get(key) || [];
    buffer.push(`${JSON.stringify(event)}\n`);
    this.buffers.set(key, buffer);

    if (buffer.length >= this.maxBufferedEvents) {
      void this.flushKey(key, this.getTraceFilePath(variant, episodeNumber));
    }
  }

  public async finalizeEpisode(
    recorder: EpisodeTraceRecorder,
    summary: Omit<TraceEpisodeSummary, 'traceFile' | 'summaryFile' | 'eventCount'>
  ): Promise<void> {
    const key = `${recorder.getVariant()}:${recorder.getEpisodeNumber()}`;
    const traceFile = recorder.getTraceFilePath();
    const summaryFile = recorder.getSummaryFilePath();

    await this.flushKey(key, traceFile);
    await (this.writeChains.get(key) || Promise.resolve());

    const fullSummary: TraceEpisodeSummary = {
      ...summary,
      eventCount: recorder.getEvents().length,
      traceFile,
      summaryFile,
    };

    fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
    fs.writeFileSync(summaryFile, summarizeEpisodeTrace(fullSummary), 'utf-8');
  }

  public async close(): Promise<void> {
    const keys = Array.from(this.buffers.keys());
    for (const key of keys) {
      const [variant, episodeNumber] = key.split(':');
      await this.flushKey(
        key,
        this.getTraceFilePath(variant as TraceVariant, Number(episodeNumber))
      );
    }

    await Promise.all(this.writeChains.values());
  }

  private async flushKey(key: string, targetFile: string): Promise<void> {
    const buffered = this.buffers.get(key);
    if (!buffered || buffered.length === 0) {
      return;
    }

    this.buffers.set(key, []);
    const payload = buffered.join('');
    const previous = this.writeChains.get(key) || Promise.resolve();
    const next = previous.then(async () => {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      await fs.promises.appendFile(targetFile, payload, 'utf-8');
    });

    this.writeChains.set(key, next);
    await next;
  }
}
