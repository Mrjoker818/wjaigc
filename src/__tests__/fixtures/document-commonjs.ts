import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';

export function loadDocumentCommonJs<T>(
  sourceUrl: URL,
  dependencies: Readonly<Record<string, unknown>> = {},
): T {
  const filename = fileURLToPath(sourceUrl);
  const { outputText } = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const nativeRequire = createRequire(sourceUrl);
  const requireDependency = (specifier: string): unknown => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (isBuiltin(specifier)) return nativeRequire(specifier);
    throw new Error(`Unexpected CommonJS dependency ${specifier} in ${filename}`);
  };

  // Evaluate a fresh module in the same realm so it sees the shared execution registry.
  const commonJsModule = { exports: {} as T };
  const evaluate = runInThisContext(`(function(exports, require, module) {${outputText}\n})`, {
    filename,
  }) as (exports: T, require: typeof requireDependency, moduleRecord: typeof commonJsModule) => void;
  evaluate(commonJsModule.exports, requireDependency, commonJsModule);
  return commonJsModule.exports;
}
