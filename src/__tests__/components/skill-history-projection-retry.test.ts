import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Execute the production rejection callback without mounting unrelated chat UI.
function loadProjectionFailureHandler(bindings: Record<string, unknown>): (error: Error) => void {
  const file = resolve(process.cwd(), 'src/components/chat-panel.tsx');
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'catch') {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback)
        && callback.getText(source).includes('setSkillProjectionRetry')) matches.push(callback);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (matches.length !== 1) throw new Error('Expected one production projection rejection handler');
  const compiled = ts.transpileModule(`const handler = ${matches[0].getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn handler;`)(...Object.values(bindings)) as (error: Error) => void;
}

function harness(restoreDeletedPlacement: boolean) {
  const retry = vi.fn();
  const error = vi.fn();
  const controller = new AbortController();
  const context = { runId: 'run-1', restoreDeletedPlacement };
  const reject = loadProjectionFailureHandler({
    context, controller, toast: { error },
    activeCanvasSkillRunRef: { current: context },
    skillProjectionAttemptCountsRef: { current: new Map([['run-1', 1]]) },
    setSkillProjectionRetry: retry,
  });
  return { reject, retry, error, controller };
}

describe('Skill history projection retry authorization', () => {
  it('does not automatically repeat explicit restoration after its committed response is lost', () => {
    const test = harness(true);
    // The remote restore can have committed and the user can have deleted again.
    // A network rejection cannot establish that the first restore did not happen.
    test.reject(new TypeError('Failed to fetch'));
    expect(test.error).toHaveBeenCalledOnce();
    expect(test.retry).not.toHaveBeenCalled();
  });

  it('retains bounded automatic retry for ordinary output projection', () => {
    const test = harness(false);
    test.reject(new TypeError('Failed to fetch'));
    expect(test.retry).toHaveBeenCalledOnce();
  });

  it('does not retry an aborted projection', () => {
    const test = harness(false);
    test.controller.abort();
    test.reject(new TypeError('Failed to fetch'));
    expect(test.retry).not.toHaveBeenCalled();
    expect(test.error).not.toHaveBeenCalled();
  });
});
