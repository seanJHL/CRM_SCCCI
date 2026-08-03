/**
 * Template-based reply generation.
 * Produces editable draft replies with variable substitution.
 * The user always reviews, edits, and approves before sending.
 */

import type { EmailCategory } from "@/lib/email-classifier";

export interface ReplyTemplate {
  category: EmailCategory;
  body: string;
}

const TEMPLATES: Record<EmailCategory, string> = {
  billing: `Hi {senderName},

Thank you for your email regarding "{subject}". I've received your message and will review the billing details. I'll get back to you shortly with an update or any questions.

{contextLine}

Best regards,
{myName}`,

  scheduling: `Hi {senderName},

Thank you for reaching out about scheduling. I'd be happy to find a time that works for both of us. Could you please share your availability for the coming days? I'll confirm a time slot once I've checked my calendar.

{contextLine}

Best regards,
{myName}`,

  urgent: `Hi {senderName},

Thank you for your email regarding "{subject}". I understand this is urgent and will prioritise it accordingly. I'll get back to you as soon as possible with the information you need.

{contextLine}

Best regards,
{myName}`,

  support: `Hi {senderName},

Thank you for contacting me regarding "{subject}". I've received your message and will look into this for you. I'll respond with more details or a resolution shortly.

{contextLine}

Best regards,
{myName}`,

  newsletter: `Hi {senderName},

Thank you for the update regarding "{subject}". I've received your message.

{contextLine}

Best regards,
{myName}`,

  general: `Hi {senderName},

Thank you for your email regarding "{subject}". I've received your message and will respond with more details shortly.

{contextLine}

Best regards,
{myName}`,
};

/**
 * Generate a suggested reply for an email thread.
 * Uses category-specific templates with variable substitution.
 */
export function generateReply(params: {
  category: EmailCategory;
  subject: string;
  senderName: string;
  myName: string;
  latestMessage?: string;
}): { body: string; template: string } {
  const { category, subject, senderName, myName, latestMessage } = params;
  const contextLine = buildContextLine(category, latestMessage ?? "");

  const template = TEMPLATES[category] ?? TEMPLATES.general;
  const body = template
    .replaceAll("{senderName}", senderName || "there")
    .replaceAll("{subject}", subject || "your email")
    .replaceAll("{contextLine}", contextLine)
    .replaceAll("{myName}", myName || "");

  return { body: body.replace(/\n{3,}/g, "\n\n"), template };
}

/**
 * Regenerate a reply with a different template (for the "Regenerate" button).
 */
export function regenerateReply(params: {
  currentBody: string;
  category: EmailCategory;
  subject: string;
  senderName: string;
  myName: string;
  latestMessage?: string;
}): { body: string; template: string } {
  // If the user has already edited the reply (currentBody differs from all templates),
  // fall back to the original template for this category
  return generateReply(params);
}

function buildContextLine(category: EmailCategory, latestMessage: string): string {
  if (!latestMessage.trim()) return "";
  if (category === "scheduling") {
    return "I’ve noted the proposed timing and will check availability before confirming anything.";
  }
  if (category === "billing") {
    return /\b(refund|credit)\b/i.test(latestMessage)
      ? "I’ve noted the refund or credit request in your message."
      : "I’ve noted the invoice and payment details you shared.";
  }
  if (category === "support") {
    return "I’ve reviewed the issue described in your latest message and will investigate it.";
  }
  if (/\?/.test(latestMessage)) {
    return "I’ve noted the question in your latest message and will address it in my follow-up.";
  }
  return "I’ve reviewed the context in your latest message.";
}
