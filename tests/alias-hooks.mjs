/**
 * Teaches the test runner the `@/` alias the app's imports use.
 *
 * The source is written for the bundler's resolver, which knows the alias;
 * plain Node does not. Rather than making the modules under test import each
 * other differently from every other file in the project, the alias is
 * resolved here, in the one place that needs it.
 */
const root = new URL("../", import.meta.url);

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const path = specifier.slice(2);
  // The app omits extensions; Node requires them.
  const target = /\.[a-z]+$/i.test(path) ? path : `${path}.ts`;
  return next(new URL(target, root).href, context);
}
