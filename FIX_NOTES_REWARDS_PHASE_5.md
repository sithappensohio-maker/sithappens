# Rewards / Referrals / Trivia Phase 5

Safe cleanup phase for engagement/reward systems.

## Added
- New `Rewards` sidebar screen.
- Rewards Center dashboard for referral rewards, trivia perks, credit audit, and recent reward credit grants.
- Referral rewards now write to a non-cash `rewards_ledger` and credit adjustment history.
- Referral reward remains Garrett's simple rule: +1 daycare credit.
- Pending referrals are inferred from clients with a referral code before payout so old records do not need a destructive migration.
- Manual grant button for referral rewards from the Rewards Center.
- Trivia milestone awarding now uses `current_streak >= milestone days` and skips milestones already earned, instead of exact-only matching.
- Trivia redemption can optionally grant 0.5 or 1 daycare credit.
- Credits audit CSV export.
- `rewards_ledger` included in backups.

## Safety
- No clients/dogs/bookings/credits are deleted.
- Referral/trivia reward credits are grants and do not count as cash income.
- Existing referral rows continue to work; missing status fields are treated as paid history.
