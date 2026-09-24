import { Sidebar } from './Sidebar.jsx';
import { Toaster } from '../ops/toast.jsx';
import { DrawerHost } from '../ops/DrawerHost.jsx';

export function AppShell({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">{children}</div>
      <DrawerHost />
      <Toaster />
    </div>
  );
}

export default AppShell;
