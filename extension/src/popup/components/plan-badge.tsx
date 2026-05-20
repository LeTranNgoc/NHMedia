import type { Tier } from '@translate-voice/shared';

interface PlanBadgeProps {
  tier: Tier;
}

const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  starter: 'Starter',
  standard: 'Standard',
  pro: 'Pro',
  unlimited: 'Unlimited',
};

/**
 * Chip hiển thị tier plan.
 * Free = grey, paid tiers = amber/gold.
 */
export function PlanBadge({ tier }: PlanBadgeProps) {
  const isPaid = tier !== 'free';

  return (
    <span
      role="status"
      aria-label={`Plan: ${TIER_LABELS[tier]}`}
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        isPaid
          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400/60'
          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-300',
      ].join(' ')}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
