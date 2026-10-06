/** Accept only the file path selected by this Node process for ONNX output. */
export function resolveOnnxReportedOutput(
  output: { outputFile?: unknown; image?: unknown },
  expectedFilePath: string | null,
): { kind: 'file'; path: string } | { kind: 'data'; url: string } | null {
  if (expectedFilePath) {
    return output.outputFile === expectedFilePath && !output.image
      ? { kind: 'file', path: expectedFilePath }
      : null;
  }
  if (output.outputFile || typeof output.image !== 'string' || !output.image) return null;
  return { kind: 'data', url: `data:image/png;base64,${output.image}` };
}
