module.exports = {
  testEnvironment: 'node',
  testMatchPatterns: [
    'domains/users/user.*.test.ts'
  ],
  collectCoverageFrom: 'all',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
