export type ResultRequestKind = 'overview' | 'history' | 'sync';

export type ResultRequestToken = {
  kind: ResultRequestKind;
  sessionId: number;
  requestId: number;
};

export class ResultRequestTracker {
  private sessionId = 0;
  private readonly requestIds: Record<ResultRequestKind, number> = {
    overview: 0,
    history: 0,
    sync: 0,
  };

  beginSession(): number {
    this.sessionId += 1;
    this.requestIds.overview = 0;
    this.requestIds.history = 0;
    this.requestIds.sync = 0;
    return this.sessionId;
  }

  get currentSessionId(): number {
    return this.sessionId;
  }

  beginRequest(kind: ResultRequestKind): ResultRequestToken {
    this.requestIds[kind] += 1;
    return {
      kind,
      sessionId: this.sessionId,
      requestId: this.requestIds[kind],
    };
  }

  isCurrent(token: ResultRequestToken): boolean {
    return token.sessionId === this.sessionId
      && token.requestId === this.requestIds[token.kind];
  }
}
