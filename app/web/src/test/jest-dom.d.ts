// jest-dom ships this augmentation itself, at '@testing-library/jest-dom/vitest'
// — but that file lives in app/node_modules, so its `declare module 'vitest'`
// resolves to the hoisted vitest 2.1.9 that shared/api use, not the vitest 4
// under web/node_modules that these specs import. Declaring it here puts the
// augmentation on the module identity the specs actually see. Same root cause
// as the explicit `expect.extend` in setup.ts.
export {};

type TestingLibraryMatchers<E, R> =
  import('@testing-library/jest-dom/matchers').TestingLibraryMatchers<E, R>;

declare module 'vitest' {
  // `T = any` mirrors vitest's own declaration; interface merging requires the
  // type parameters to be identical, so `unknown` does not compile here.
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
