/**
 * Password policy (pure validation). Hashing happens at the application
 * boundary with argon2id — passwords are never logged or returned.
 */
export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true
};

export function validatePassword(password: string, policy = DEFAULT_PASSWORD_POLICY): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) {
    problems.push(`كلمة المرور يجب ألا تقل عن ${policy.minLength} حروف`);
  }
  if (policy.requireUpper && !/[A-Z]/.test(password)) {
    problems.push("يجب أن تحتوي حرفاً كبيراً واحداً على الأقل");
  }
  if (policy.requireLower && !/[a-z]/.test(password)) {
    problems.push("يجب أن تحتوي حرفاً صغيراً واحداً على الأقل");
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    problems.push("يجب أن تحتوي رقماً واحداً على الأقل");
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    problems.push("يجب أن تحتوي رمزاً خاصاً واحداً على الأقل");
  }
  return problems;
}

export function isStrongPassword(password: string, policy = DEFAULT_PASSWORD_POLICY): boolean {
  return validatePassword(password, policy).length === 0;
}

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
