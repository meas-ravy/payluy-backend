/** ponytail: console is the logger; swap for pino if structured logs are ever needed. */
export const log = (scope: string) => ({
  error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  info: (...args: unknown[]) => console.log(`[${scope}]`, ...args),
});
