/**
 * Rules-based email classification engine.
 * Uses keyword/regex matching to categorise emails, score priority,
 * detect response requirements, and explain importance reasoning.
 * No external AI service is used.
 */

export type EmailCategory =
  | "billing"
  | "scheduling"
  | "urgent"
  | "support"
  | "newsletter"
  | "general";

export type EmailPriority = "critical" | "high" | "normal" | "low";

export interface ClassificationResult {
  category: EmailCategory;
  priority: EmailPriority;
  priorityScore: number;
  requiresResponse: boolean;
  importanceReasons: string[];
  hasMeetingRequest: boolean;
}

interface CategoryRule {
  category: EmailCategory;
  keywords: RegExp;
  label: string;
}

interface PriorityRule {
  keywords: RegExp;
  score: number;
  label: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "billing",
    keywords: /\b(invoice|receipt|payment|billing|quote|proposal|purchase|order|refund|subscription|pricing)\b/i,
    label: "billing",
  },
  {
    category: "scheduling",
    keywords: /\b(meeting|schedule|call|appointment|calendar|availability|book a time|free at|available on|meet up|catch up|sync)\b/i,
    label: "scheduling",
  },
  {
    category: "urgent",
    keywords: /\b(urgent|asap|immediately|deadline|action required|time-sensitive|critical|emergency|today|right away)\b/i,
    label: "urgent",
  },
  {
    category: "support",
    keywords: /\b(support|help|question|issue|problem|bug|error|broken|not working|can.?t|unable|fail)\b/i,
    label: "support",
  },
  {
    category: "newsletter",
    keywords: /\b(newsletter|unsubscribe|promotion|offer|discount|sale|deal|limited time|opt out)\b/i,
    label: "newsletter",
  },
];

const PRIORITY_RULES: PriorityRule[] = [
  { keywords: /\b(urgent|asap|immediately|emergency|critical)\b/i, score: 95, label: "Contains urgency keywords" },
  { keywords: /\b(deadline|action required|time-sensitive|today|right away)\b/i, score: 85, label: "Contains deadline keywords" },
  { keywords: /\b(important|priority|must|need to|required)\b/i, score: 70, label: "Contains importance keywords" },
  { keywords: /\?\s*$/, score: 50, label: "Contains a question requiring response" },
  { keywords: /\b(please|can you|could you|would you|will you)\b/i, score: 45, label: "Contains a polite request" },
  { keywords: /\b(when|where|what time|how soon|by when)\b/i, score: 55, label: "Contains a scheduling question" },
  { keywords: /\b(confirm|confirmation|verify|approval|approve)\b/i, score: 60, label: "Requires confirmation or approval" },
  { keywords: /\b(newsletter|unsubscribe|promotion|no-reply|noreply|donotreply)\b/i, score: -20, label: "Appears to be an automated/newsletter email" },
];

const RESPONSE_INDICATORS =
  /\?|(\bplease\b)|(\bcan you\b)|(\bcould you\b)|(\bneed\b)|(\bwhen\b)|(\bconfirm\b)|(\blet me know\b)|(\breply\b)|(\brespond\b)|(\baction\b)|(\bwaiting\b)|(\bfollow.?up\b)/i;

const MEETING_KEYWORDS =
  /\b(meet|meeting|schedule|call|appointment|availability|free at|available on|book a time|slot|calendar|sync up|catch up|catchup)\b/i;

/**
 * Classify an email based on subject, sender, and body content.
 */
export function classifyEmail(
  subject: string,
  fromEmail: string,
  body: string,
): ClassificationResult {
  const text = `${subject} ${body}`;
  const importanceReasons: string[] = [];

  // --- Category detection ---

  let category: EmailCategory = "general";
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(text)) {
      category = rule.category;
      importanceReasons.push(`Categorised as "${rule.label}" based on keyword match`);
      break;
    }
  }

  // Check sender for newsletter patterns
  const isAutomated =
    /\b(noreply|no-reply|donotreply|notifications|newsletter|updates|mailer)\b/i.test(
      fromEmail,
    );
  if (isAutomated && category === "general") {
    category = "newsletter";
    importanceReasons.push("Sender address appears to be automated");
  }

  // --- Priority scoring ---

  let priorityScore = 30; // Base score
  for (const rule of PRIORITY_RULES) {
    if (rule.keywords.test(text)) {
      priorityScore += rule.score;
      importanceReasons.push(rule.label);
    }
  }

  // Clamp score
  priorityScore = Math.max(0, Math.min(100, priorityScore));

  let priority: EmailPriority = "normal";
  if (priorityScore >= 80) priority = "critical";
  else if (priorityScore >= 60) priority = "high";
  else if (priorityScore >= 40) priority = "normal";
  else priority = "low";

  // Override: urgent category always gets at least high priority
  if (category === "urgent" && priorityScore < 60) {
    priorityScore = 65;
    priority = "high";
  }

  // Newsletter always low priority
  if (category === "newsletter") {
    priority = "low";
    priorityScore = Math.min(priorityScore, 20);
  }

  // --- Response detection ---

  const requiresResponse =
    RESPONSE_INDICATORS.test(text) && !isAutomated;

  if (requiresResponse) {
    importanceReasons.push("Contains language indicating a response is needed");
  }

  // --- Meeting request detection ---

  const hasMeetingRequest = MEETING_KEYWORDS.test(text);
  if (hasMeetingRequest) {
    importanceReasons.push("Contains scheduling or meeting-related keywords");
  }

  // Deduplicate reasons
  const uniqueReasons = [...new Set(importanceReasons)];

  return {
    category,
    priority,
    priorityScore,
    requiresResponse,
    importanceReasons: uniqueReasons,
    hasMeetingRequest,
  };
}

/**
 * Bulk classify multiple emails.
 */
export function bulkClassify(
  threads: { subject: string; fromEmail: string; body: string }[],
): ClassificationResult[] {
  return threads.map((t) => classifyEmail(t.subject, t.fromEmail, t.body));
}
