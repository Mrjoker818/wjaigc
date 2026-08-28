import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const appRoot = path.join(process.cwd(), 'src/app');

const allowedRouteExports = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
]);

interface RouteExportViolation {
  route: string;
  exports: string[];
}

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(entryPath);
    return entry.isFile() && entry.name === 'route.ts' ? [entryPath] : [];
  });
}

function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (
    ts.isOmittedExpression(element) ? [] : collectBindingNames(element.name)
  ));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function collectExportedNames(sourceFile: ts.SourceFile): string[] {
  const exportedNames: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      exportedNames.push('default');
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        exportedNames.push('*');
      } else if (ts.isNamedExports(statement.exportClause)) {
        exportedNames.push(...statement.exportClause.elements.map((element) => element.name.text));
      } else {
        exportedNames.push(statement.exportClause.name.text);
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      exportedNames.push('default');
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      exportedNames.push(...statement.declarationList.declarations.flatMap((declaration) => (
        collectBindingNames(declaration.name)
      )));
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) {
      if (statement.name) {
        exportedNames.push(statement.name.getText(sourceFile));
      }
    }
  }

  return [...new Set(exportedNames)].sort();
}

function relativeRoutePath(routePath: string): string {
  return path.relative(process.cwd(), routePath).replaceAll('\\', '/');
}

describe('Next.js route module export contract', () => {
  it('exports only HTTP handlers and supported Next 16 route configuration', () => {
    const violations: RouteExportViolation[] = collectRouteFiles(appRoot)
      .sort((left, right) => relativeRoutePath(left).localeCompare(relativeRoutePath(right)))
      .map((routePath): RouteExportViolation => {
        const sourceFile = ts.createSourceFile(
          routePath,
          readFileSync(routePath, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
        return {
          route: relativeRoutePath(routePath),
          exports: collectExportedNames(sourceFile).filter((name) => !allowedRouteExports.has(name)),
        };
      })
      .filter((violation) => violation.exports.length > 0);

    expect(violations).toEqual([]);
  });
});
