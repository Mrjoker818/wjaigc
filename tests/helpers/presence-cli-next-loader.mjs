export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next') {
    return { url: new URL('./presence-cli-next-fixture.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
