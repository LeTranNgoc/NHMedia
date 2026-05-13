import type { Tier } from '@translate-voice/shared';

interface PlanBadgeProps {
  tier: Tier;
}

/**
 * Chip hiển thị Free / Pro plan.
 * Free = grey chip, Pro = amber/gold chip.
 */
export function PlanBadge({ tier }: PlanBadgeProps) {
  const isPro = tier === 'pro';

  return (
    <span
      role="status"
      aria-label={`Plan: ${isPro ? 'Pro' : 'Free'}`}
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        isPro
          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400/60'
          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-300',
      ].join(' ')}
    >
      {isPro ? 'Pro' : 'Free'}
    </span>
  );
}
