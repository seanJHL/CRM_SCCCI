/**
 * Centralised TanStack Query key factory.
 * Keeps cache keys consistent and refactor-safe.
 */
export const queryKeys = {
  companies: {
    all: ["companies"] as const,
    detail: (id: string) => ["companies", id] as const,
  },
  contacts: {
    all: ["contacts"] as const,
    detail: (id: string) => ["contacts", id] as const,
  },
  deals: {
    all: ["deals"] as const,
    detail: (id: string) => ["deals", id] as const,
  },
} as const;

/** Type definitions matching the backend Drizzle schema. */
export interface Company {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  companyId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  companyId: string | null;
  contactId: string | null;
  title: string;
  status: string;
  value: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEAL_STATUSES = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;
