// O pacote traz `register-hooks.d.ts`, que o TypeScript não associa a um arquivo `.mjs`.
declare module 'import-in-the-middle/register-hooks.mjs' {
  export function register(options?: { include?: (string | RegExp)[] }): void;
  export function supportsSyncHooks(): boolean;
}
