import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanBadge } from './plan-badge';
import { UsageMeter } from './usage-meter';
import { UpgradeCta } from './upgrade-cta';

// ── PlanBadge ─────────────────────────────────────────────────────────────────

describe('PlanBadge', () => {
  it('renders "Free" for free tier', () => {
    render(<PlanBadge tier="free" />);
    expect(screen.getByRole('status')).toHaveTextContent('Free');
  });

  it('renders "Pro" for pro tier', () => {
    render(<PlanBadge tier="pro" />);
    expect(screen.getByRole('status')).toHaveTextContent('Pro');
  });

  it('has accessible aria-label for free', () => {
    render(<PlanBadge tier="free" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Plan: Free');
  });

  it('has accessible aria-label for pro', () => {
    render(<PlanBadge tier="pro" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Plan: Pro');
  });

  it('applies amber styles for pro', () => {
    const { container } = render(<PlanBadge tier="pro" />);
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });

  it('applies gray styles for free', () => {
    const { container } = render(<PlanBadge tier="free" />);
    expect(container.firstChild).toHaveClass('bg-gray-100');
  });

  it('renders "Starter" for starter tier with paid styling', () => {
    const { container } = render(<PlanBadge tier="starter" />);
    expect(screen.getByRole('status')).toHaveTextContent('Starter');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Plan: Starter');
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });

  it('renders "Standard" for standard tier with paid styling', () => {
    const { container } = render(<PlanBadge tier="standard" />);
    expect(screen.getByRole('status')).toHaveTextContent('Standard');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Plan: Standard');
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });

  it('renders "Unlimited" for unlimited tier with paid styling', () => {
    const { container } = render(<PlanBadge tier="unlimited" />);
    expect(screen.getByRole('status')).toHaveTextContent('Unlimited');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Plan: Unlimited');
    expect(container.firstChild).toHaveClass('bg-amber-100');
  });
});

// ── UsageMeter ────────────────────────────────────────────────────────────────

describe('UsageMeter — free tier', () => {
  it('shows used / limit text', () => {
    render(<UsageMeter secondsCaptured={300} limitSeconds={900} />);
    expect(screen.getByText(/5m 0s \/ 15m 0s/)).toBeInTheDocument();
  });

  it('shows remaining time', () => {
    render(<UsageMeter secondsCaptured={300} limitSeconds={900} />);
    expect(screen.getByText(/Còn 10m 0s/)).toBeInTheDocument();
  });

  it('sets correct progressbar aria attributes', () => {
    render(<UsageMeter secondsCaptured={450} limitSeconds={900} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('shows "Đã hết quota" when at 100%', () => {
    render(<UsageMeter secondsCaptured={900} limitSeconds={900} />);
    expect(screen.getByText(/Đã hết quota hôm nay/)).toBeInTheDocument();
  });

  it('shows "Đã hết quota" when over limit', () => {
    render(<UsageMeter secondsCaptured={950} limitSeconds={900} />);
    expect(screen.getByText(/Đã hết quota hôm nay/)).toBeInTheDocument();
  });

  it('shows 0s remaining at boundary 900s', () => {
    render(<UsageMeter secondsCaptured={900} limitSeconds={900} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('UsageMeter — pro tier (unlimited)', () => {
  it('shows "Không giới hạn" text', () => {
    render(<UsageMeter secondsCaptured={5000} limitSeconds={null} />);
    expect(screen.getByText(/Không giới hạn/)).toBeInTheDocument();
  });

  it('shows seconds used even when unlimited', () => {
    render(<UsageMeter secondsCaptured={3600} limitSeconds={null} />);
    expect(screen.getByText(/1h|60m|3600s|đã dùng/i)).toBeInTheDocument();
  });

  it('progressbar is full (100) for unlimited', () => {
    render(<UsageMeter secondsCaptured={0} limitSeconds={null} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});

// ── UpgradeCta ────────────────────────────────────────────────────────────────

describe('UpgradeCta', () => {
  it('renders upgrade button', () => {
    render(<UpgradeCta onUpgrade={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Nâng cấp Pro/i })).toBeInTheDocument();
  });

  it('calls onUpgrade when button clicked', () => {
    const onUpgrade = vi.fn();
    render(<UpgradeCta onUpgrade={onUpgrade} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it('shows loading spinner when loading=true', () => {
    render(<UpgradeCta onUpgrade={vi.fn()} loading={true} />);
    expect(screen.getByText(/Đang mở trang thanh toán/)).toBeInTheDocument();
  });

  it('disables button when loading=true', () => {
    render(<UpgradeCta onUpgrade={vi.fn()} loading={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disables button when disabled=true', () => {
    render(<UpgradeCta onUpgrade={vi.fn()} disabled={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not call onUpgrade when disabled', () => {
    const onUpgrade = vi.fn();
    render(<UpgradeCta onUpgrade={onUpgrade} disabled={true} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it('has minimum touch target height of 44px via CSS class', () => {
    render(<UpgradeCta onUpgrade={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('min-h-[44px]');
  });
});
