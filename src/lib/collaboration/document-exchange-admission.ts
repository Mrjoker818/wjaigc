import 'server-only';
import { DocumentExchangeError } from './document-exchange-access';
import { getDocumentExecutionScope, reserveDocumentExecutionActor, documentExecutionHttpFailure } from './document-execution-scope';

// Process-local resource guard, NOT authorization or a cross-instance business quota.
// Each admitted request owns at most the 1 MiB input ceiling until its finally block.
const actors = new Map<string, number>();
let admitted = 0;
export function reserveDocumentExchangeRequest(actorId: string): () => void {
  if (getDocumentExecutionScope()) {
    try { return reserveDocumentExecutionActor(actorId); }
    catch (error) {
      if (documentExecutionHttpFailure(error)?.code === 'DOCUMENT_EXCHANGE_BUSY') {
        throw new DocumentExchangeError('DOCUMENT_EXCHANGE_BUSY', error);
      }
      throw error;
    }
  }
  const count = actors.get(actorId) ?? 0;
  if (admitted >= 8 || count >= 2) throw new DocumentExchangeError('DOCUMENT_EXCHANGE_BUSY');
  admitted++; actors.set(actorId, count + 1);
  let released = false;
  return (): void => {
    if (released) return;
    released = true; admitted--;
    const remaining = (actors.get(actorId) ?? 1) - 1;
    if (remaining === 0) actors.delete(actorId); else actors.set(actorId, remaining);
  };
}
