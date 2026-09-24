// Shared mutable state for integration tests — mimics DB-backed proposal resolution
export const confirmedProposals = new Set<string>()
export const rejectedProposals = new Set<string>()

export interface StoredProposal {
  id: string
  userId: string
  action: string
  args: Record<string, any>
  status: 'pending' | 'confirmed' | 'rejected'
}

/** In-memory proposal registry keyed by proposal_id. */
export const proposals = new Map<string, StoredProposal>()

/** Default user for proposals registered through this fixture. */
export const TEST_USER_ID = 'user_founder01'

/* -------------------------------------------------------------------------- */
/* Auto-seed the chat stub's known test proposals                             */
/*                                                                             */
/* The chat/route.ts SSE stub emits three hardcoded `create_goal` proposals   */
/* (prop_001 / prop_002 / prop_003). The TestChatFlow integration test reads   */
/* them off the wire and immediately calls /api/tools/confirm with just the   */
/* `proposal_id` — no body fields that would carry `action` / `args`. Without  */
/* these defaults the confirm route has no way to recover the proposal's       */
/* content. Register them once at module load so the test fixture is          */
/* self-contained (does not require chat/route.ts to also write here).        */
/* -------------------------------------------------------------------------- */

const SEED_PROPOSALS: StoredProposal[] = [
  {
    id: 'prop_001',
    userId: TEST_USER_ID,
    action: 'create_goal',
    args: {
      title: 'Build a running habit this quarter',
      horizon: 'medium',
      why: 'Improve health and discipline',
      first_action: 'Schedule 3 runs this week',
      target_date: '2026-12-31',
    },
    status: 'pending',
  },
  {
    id: 'prop_002',
    userId: TEST_USER_ID,
    action: 'create_goal',
    args: {
      title: 'Ship side-project MVP in 2 months',
      horizon: 'short',
      why: 'Get to market validation',
      first_action: 'Define the core feature set',
      target_date: '2026-11-30',
    },
    status: 'pending',
  },
  {
    id: 'prop_003',
    userId: TEST_USER_ID,
    action: 'create_goal',
    args: {
      title: 'Read 12 books this year',
      horizon: 'long',
      why: 'Broaden knowledge base',
      first_action: 'Pick the first 3 books',
      target_date: '2026-12-31',
    },
    status: 'pending',
  },
  // Special ID used by `confirm.test.ts` to assert the 409 already-resolved
  // path. Already marked resolved on load so the very first confirm returns
  // 409 with no mutation needed.
  {
    id: 'prop_already_confirmed',
    userId: TEST_USER_ID,
    action: 'create_goal',
    args: { title: 'Already-resolved fixture', horizon: 'medium' },
    status: 'confirmed',
  },
]

for (const p of SEED_PROPOSALS) {
  proposals.set(p.id, p)
}

export function registerProposal(p: StoredProposal) {
  proposals.set(p.id, p)
}

export function getProposal(proposalId: string): StoredProposal | undefined {
  return proposals.get(proposalId)
}

export function setProposalStatus(
  proposalId: string,
  status: StoredProposal['status']
) {
  const p = proposals.get(proposalId)
  if (p) p.status = status
}

export function markConfirmed(proposalId: string) {
  confirmedProposals.add(proposalId)
  setProposalStatus(proposalId, 'confirmed')
}

export function isConfirmed(proposalId: string) {
  return confirmedProposals.has(proposalId)
}

export function markRejected(proposalId: string) {
  rejectedProposals.add(proposalId)
  setProposalStatus(proposalId, 'rejected')
}

export function isRejected(proposalId: string) {
  return rejectedProposals.has(proposalId)
}