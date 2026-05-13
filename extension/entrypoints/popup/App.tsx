import { useState } from 'react';
import { TabNav, type TabId } from '../../src/popup/components/tab-nav';
import { MainView } from '../../src/popup/views/main-view';
import { SettingsView } from '../../src/popup/views/settings-view';
import { AccountView } from '../../src/popup/views/account-view';

function renderView(tab: TabId) {
  switch (tab) {
    case 'main':
      return <MainView />;
    case 'settings':
      return <SettingsView />;
    case 'account':
      return <AccountView />;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('main');

  return (
    <div className="flex w-80 flex-col" style={{ minHeight: '200px' }}>
      <TabNav active={activeTab} onChange={setActiveTab} />
      <main
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {renderView(activeTab)}
      </main>
    </div>
  );
}
