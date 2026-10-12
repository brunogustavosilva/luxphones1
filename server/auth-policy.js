export const MAX_LOGIN_FAILURES = 5;
export const LOCKOUT_SECONDS = 60;

export function nextFailureState(failedAttempts) {
  const failures = failedAttempts + 1;
  return {
    failedAttempts: failures,
    locked: failures >= MAX_LOGIN_FAILURES,
    lockoutSeconds: failures >= MAX_LOGIN_FAILURES ? LOCKOUT_SECONDS : 0,
  };
}
