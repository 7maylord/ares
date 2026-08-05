import { Logger } from '@nestjs/common';

// Mute Nest's logger during unit tests. The error-path tests deliberately trigger
// failures the services report via logger.error/warn (e.g. "analysis failed",
// "execution reverted") — that output is expected, not a test failure, and its
// stack traces make green runs look alarming. No test asserts on logger calls.
beforeEach(() => {
  for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});
