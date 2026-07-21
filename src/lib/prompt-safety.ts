/**
 * Prompt Content Safety Checker
 * 
 * Provides client-side and server-side content safety validation for user prompts.
 * Uses a multi-layer approach:
 * 1. Keyword blocklist (instant, zero-cost)
 * 2. Pattern-based detection (regex, instant)
 * 3. Optional LLM-based review (for edge cases, configurable)
 * 
 * Design principles:
 * - Fail-open: if the safety check itself fails, allow the prompt through
 *   (avoid blocking legitimate users due to safety system errors)
 * - Low false-positive: only block high-confidence violations
 * - Configurable: admin can enable/disable and adjust sensitivity
 */

// ============================================================
// Category 1: Keyword Blocklist
// ============================================================

/** High-confidence blocked keywords (multi-language) */
const BLOCKED_KEYWORDS: string[] = [
  // Violence
  '血腥暴力', '杀戮', '斩首', '肢解',
  // CSAM (strict zero-tolerance)
  'child porn', 'csam', '儿童色情', '幼女色情',
  // Hate speech
  '种族灭绝', '纳粹复兴',
  // Self-harm
  '自杀方法', '如何自杀',
];

/** Moderate-confidence warning keywords (allowed but logged) */
const WARNING_KEYWORDS: string[] = [
  '暴力', '血腥', 'gore', 'violent',
  'nude', 'naked', '裸体', '裸露',
  'weapon', '枪支', '爆炸',
];

// ============================================================
// Category 2: Pattern-based Detection
// ============================================================

/** Patterns that strongly indicate policy-violating content */
const BLOCKED_PATTERNS: RegExp[] = [
  // Explicit CSAM patterns
  /\b(underage|minor|child)\s*(sex|nude|porn|裸|色情)/i,
  // Bomb-making instructions
  /\b(how\s+to\s+make|make\s+a)\s+(bomb|explosive|IED)/i,
  // Self-harm instructions
  /\b(how\s+to|methods?\s+to)\s+(kill\s+yourself|commit\s+suicide|self.?harm)/i,
];

/** Patterns that may indicate borderline content */
const WARNING_PATTERNS: RegExp[] = [
  // Graphic violence descriptions
  /\b(decapitat|dismemb|mutilat|eviscerat)/i,
  // Hate symbols
  /swastika|卐|卍/i,
];

// ============================================================
// Types
// ============================================================

export interface SafetyCheckResult {
  /** Whether the prompt passes the safety check */
  safe: boolean;
  /** Severity level: 'pass' | 'warning' | 'block' */
  level: 'pass' | 'warning' | 'block';
  /** Human-readable reason (empty if passed) */
  reason: string;
  /** Which category triggered the result */
  category?: 'keyword' | 'pattern' | 'llm';
  /** Specific matched term/pattern (for debugging) */
  matched?: string;
}

// ============================================================
// Core Check Function
// ============================================================

/**
 * Check a prompt for content safety violations.
 * This is a synchronous, fast check using keyword and pattern matching.
 * Returns a SafetyCheckResult indicating whether the prompt is safe.
 */
export function checkPromptSafety(prompt: string): SafetyCheckResult {
  if (!prompt || typeof prompt !== 'string') {
    return { safe: true, level: 'pass', reason: '' };
  }

  const normalizedPrompt = prompt.toLowerCase();

  // Layer 1: Keyword blocklist check (highest priority)
  for (const keyword of BLOCKED_KEYWORDS) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        level: 'block',
        reason: `内容包含违规关键词`,
        category: 'keyword',
        matched: keyword,
      };
    }
  }

  // Layer 2: Pattern-based block check
  for (const pattern of BLOCKED_PATTERNS) {
    const match = pattern.exec(prompt);
    if (match) {
      return {
        safe: false,
        level: 'block',
        reason: `内容匹配违规模式`,
        category: 'pattern',
        matched: match[0],
      };
    }
  }

  // Layer 3: Warning keyword check (allowed but flagged)
  for (const keyword of WARNING_KEYWORDS) {
    if (normalizedPrompt.includes(keyword.toLowerCase())) {
      return {
        safe: true,
        level: 'warning',
        reason: `内容可能包含敏感词汇，请确认合规后继续`,
        category: 'keyword',
        matched: keyword,
      };
    }
  }

  // Layer 4: Warning pattern check
  for (const pattern of WARNING_PATTERNS) {
    const match = pattern.exec(prompt);
    if (match) {
      return {
        safe: true,
        level: 'warning',
        reason: `内容可能包含敏感模式，请确认合规后继续`,
        category: 'pattern',
        matched: match[0],
      };
    }
  }

  return { safe: true, level: 'pass', reason: '' };
}

/**
 * Check prompt safety and throw if blocked.
 * Convenience wrapper for server-side API routes.
 */
export function validatePromptOrThrow(prompt: string): void {
  const result = checkPromptSafety(prompt);
  if (result.level === 'block') {
    throw new Error(`内容安全检查未通过: ${result.reason}`);
  }
}

/**
 * Log a warning-level safety result for monitoring.
 * Call this after checkPromptSafety when level is 'warning'.
 */
export function logSafetyWarning(prompt: string, result: SafetyCheckResult): void {
  if (result.level === 'warning') {
    console.warn(
      `[safety] Warning: category=${result.category ?? 'unknown'} | promptLength=${prompt.length}`,
    );
  }
}
