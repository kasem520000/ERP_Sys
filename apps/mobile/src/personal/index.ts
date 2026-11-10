/**
 * PHASE-022 T-P22-3-b · the personal area barrel (MASTER-PLAN §2 layout:
 * src/personal/ — the READ-ONLY personal-account experience; the
 * structural no-write proof in __tests__/companion-personal.test asserts
 * these modules never import enqueue or the command builders).
 */
export {
  AGING_BUCKETS,
  buildPersonalHome,
  type AgingBucket,
  type AgingRow,
  type NotificationRow,
  type PersonalHomeView,
  type RecentDocRow,
} from "./personal-home-viewmodel";
