import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { runDocumentExecution, documentExecutionHttpFailure } from './document-execution-scope';
import { isDocumentTransportUnavailable, withDocumentHttpAdmission } from './document-transport-gate';

/** The route remains responsible for authentication, authorization and error bodies. */
export async function executeDocumentRoute(
  request: NextRequest,
  work: () => Promise<NextResponse>,
  failure: (code: string, status: number) => NextResponse,
): Promise<NextResponse> {
  try {
    return await withDocumentHttpAdmission(() => runDocumentExecution({ signal: request.signal }, async scope => {
      let cancelling: Promise<void> | undefined;
      const cancelUnusedBody = (): void => {
        const body = request.body;
        // A bounded reader owns its locked or already-consumed stream.
        if (cancelling || !body || body.locked || request.bodyUsed) return;
        try { cancelling = body.cancel(); }
        catch (error) { cancelling = Promise.reject(error); }
        void cancelling.catch(() => undefined);
        // Cancellation may outlive the response or the original deadline.
        // Observe the original operation without admitting further work.
        scope.observeCleanup(cancelling);
      };
      scope.signal.addEventListener('abort', cancelUnusedBody, { once: true });
      try {
        let result: NextResponse;
        try { result = await work(); }
        catch (error) {
          if (!isDocumentTransportUnavailable(error)) throw error;
          // Keep a known successful COMMIT distinct from an unknown result.
          // allowFailureResponse below still rejects this DTO if COMMIT is uncertain.
          result = failure('DOCUMENT_TRANSPORT_DRAINING', 503);
        }
        scope.assertActive();
        // Preserve a real authorization/uncertain failure response without
        // treating it as evidence of an uncommitted or successful transaction.
        if (result.status >= 400) {
          const payload: unknown = await scope.observe(result.clone().json());
          scope.allowFailureResponse(result.status, payload);
        }
        return result;
      } finally {
        scope.signal.removeEventListener('abort', cancelUnusedBody);
        cancelUnusedBody();
      }
    }));
  } catch (error) {
    if (isDocumentTransportUnavailable(error)) return failure('DOCUMENT_TRANSPORT_DRAINING', 503);
    const scoped = documentExecutionHttpFailure(error);
    return failure(scoped?.code ?? 'DOCUMENT_INTERNAL_ERROR', scoped?.status ?? 500);
  }
}
