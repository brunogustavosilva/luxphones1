import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LOGIN_FAILURES, LOCKOUT_SECONDS, nextFailureState } from './auth-policy.js';

test('four failures do not lock the account', () => {
  assert.deepEqual(nextFailureState(3), {
    failedAttempts: 4,
    locked: false,
    lockoutSeconds: 0,
  });
});

test('the fifth failure locks login for one minute', () => {
  assert.deepEqual(nextFailureState(MAX_LOGIN_FAILURES - 1), {
    failedAttempts: MAX_LOGIN_FAILURES,
    locked: true,
    lockoutSeconds: LOCKOUT_SECONDS,
  });
});
