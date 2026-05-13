export type TabId = 'main' | 'settings' | 'account';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'main', label: 'Main' },
  { id: 'settings', label: 'Settings' },
  { id: 'account', label: 'Account' },
];

interface TabNavProps {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav
      role="tablist"
      aria-label="Popup navigation"
      className="flex border-b border-gray-200"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={[
              'flex-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              isActive
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
