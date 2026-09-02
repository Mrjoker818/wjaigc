export class AgentModelRouteMismatchError extends Error {
  readonly code = 'MODEL_ROUTE_MISMATCH';
  readonly status = 409;

  constructor() {
    super('The admitted task provider and model do not match the requested route');
    this.name = 'AgentModelRouteMismatchError';
  }
}
