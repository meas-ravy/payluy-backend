import type { Config } from 'jest';

// Unit specs sit next to the code as *.spec.ts; e2e uses test/jest-e2e.json (AGENTS.md).
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};

export default config;
