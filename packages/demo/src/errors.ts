export class ReplayerError extends Error {
  readonly status: number;
  readonly detail: unknown;
  readonly bidIndex: number;

  constructor(message: string, status: number, detail: unknown, bidIndex: number) {
    super(message);
    this.name = "ReplayerError";
    this.status = status;
    this.detail = detail;
    this.bidIndex = bidIndex;
  }
}
