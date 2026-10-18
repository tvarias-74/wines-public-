import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, RouterProvider, Routes, createHashRouter, useLocation } from 'react-router-dom';
import { CellarProvider, useCellar } from '../storage/store';
import { Icon, type IconName } from './Icon';
import { ConfirmProvider, ToastProvider } from './overlays';
import { Cellar } from './pages/Cellar';
import { Dashboard } from './pages/Dashboard';
import { Layout } from './pages/Layout';
import { Purchases } from './pages/Purchases';
import { Settings } from './pages/Settings';
import { WineDetail } from './pages/WineDetail';
import { WineForm } from './pages/WineForm';
import { createBackupFile } from '../storage/backupFiles';
import { downloadFile } from './format';
import { usePendingUpdate } from './pwa';
import { useRestore } from './restore';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/cellar', label: 'Cellar', icon: 'cellar' },
  { to: '/purchases', label: 'Purchases', icon: 'receipt' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/**
 * A new page starts at the top, is named in the tab title, and takes keyboard focus (so a screen
 * reader or keyboard user starts reading the new page, not wherever the old one left them).
 * A `#section` link goes to that section instead.
 */
function RouteEffects() {
  const { pathname, hash } = useLocation();
  const firstPage = useRef(true);

  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  useEffect(() => {
    const t = setTimeout(() => {
      const heading = document.querySelector('#main h1')?.textContent?.trim();
      document.title = heading ? `${heading} · Cellar Book` : 'Cellar Book';
      if (!firstPage.current) document.getElementById('main')?.focus({ preventScroll: true });
      firstPage.current = false;
    }, 60);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}

/** Things the user must know about while they work: unsaved changes, a newer copy elsewhere, a waiting update. */
function StatusBanners() {
  const { data, saveError, conflict, readOnly, reloadFromStorage, flushNow } = useCellar();
  const update = usePendingUpdate();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);

  const downloadMine = async () => {
    const file = await createBackupFile(data, false);
    downloadFile(file.filename.replace('backup', 'my-version'), file.blob);
  };

  const installUpdate = async () => {
    if (!update) return;
    const editing = /^\/wine\/(new|[^/]+\/edit)$/.test(pathname);
    const saved = await flushNow();
    if (!saved && !window.confirm('Some of your latest changes are not saved on this device, and reloading to update will lose them. Update anyway?')) return;
    if (saved && editing && !window.confirm('The page reloads to update. What you have typed in this form will be lost. Update now?')) return;
    await update();
  };

  return (
    <>
      {conflict && (
        <div className="banner banner-warn" role="alert">
          <Icon name="alert" />
          <div>
            <p>
              <strong>Your cellar was changed in another tab or window.</strong> The changes you made here since then have <strong>not</strong> been saved, so nothing there was overwritten.
            </p>
            <div className="banner-actions">
              <button className="btn btn-sm" onClick={() => void downloadMine()}>
                <Icon name="download" size={16} /> Download my version
              </button>
              <button className="btn btn-sm btn-primary" onClick={reloadFromStorage}>
                Load the latest
              </button>
            </div>
          </div>
        </div>
      )}
      {!conflict && readOnly && (
        <div className="banner banner-warn" role="status">
          <Icon name="alert" />
          <div>
            <p>
              <strong>Nothing you do here is being saved.</strong> This browser would not give Cellar Book a place to keep your data. Download a backup before you close the page.
            </p>
            <div className="banner-actions">
              <button className="btn btn-sm" onClick={() => void downloadMine()}>
                <Icon name="download" size={16} /> Download backup
              </button>
            </div>
          </div>
        </div>
      )}
      {!conflict && !readOnly && saveError && (
        <div className="banner banner-warn" role="alert">
          <Icon name="alert" />
          <p>
            <strong>Changes can’t be saved normally.</strong> {saveError} Download a backup so nothing is lost. <Link to="/settings#backup">Back up now</Link>
          </p>
        </div>
      )}
      {update && !dismissed && (
        <div className="banner" role="status">
          <Icon name="info" />
          <div>
            <p>
              <strong>A new version of Cellar Book is ready.</strong> Your cellar stays as it is.
            </p>
            <div className="banner-actions">
              <button className="btn btn-sm btn-primary" onClick={() => void installUpdate()}>
                Update now
              </button>
              <button className="btn btn-sm" onClick={() => setDismissed(true)}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** What is shown when the saved cellar can't be opened: kept untouched, with ways out that lose nothing. */
function UnreadableScreen() {
  const { corruptRaw, corruptReason, startFresh } = useCellar();
  const update = usePendingUpdate();
  const restore = useRestore();
  const input = useRef<HTMLInputElement>(null);
  const newer = !!corruptReason && /newer version/i.test(corruptReason);

  return (
    <main className="main corrupt" id="main" tabIndex={-1}>
      {newer ? (
        <>
          <h1>This cellar was saved by a newer version of Cellar Book</h1>
          <p>
            This page is running an older version, so it can’t open the cellar safely. Nothing has been changed or deleted. Reload to get the latest version{update ? ', or use the button below' : ''}; it will open as normal.
          </p>
        </>
      ) : (
        <>
          <h1>Your saved cellar couldn’t be read</h1>
          <p>
            Cellar Book found data on this device but can’t make sense of it{corruptReason ? ` (${corruptReason})` : ''}, so it has <strong>not</strong> changed or deleted anything. Download a copy first; then you can restore a backup file or start a fresh cellar.
          </p>
        </>
      )}
      <div className="settings-actions">
        {newer && (
          <button className="btn btn-primary" onClick={() => (update ? void update() : window.location.reload())}>
            {update ? 'Update now' : 'Reload the page'}
          </button>
        )}
        <button className={newer ? 'btn' : 'btn btn-primary'} onClick={() => downloadFile('cellar-book-unreadable-data.json', JSON.stringify(corruptRaw, null, 2) ?? '', 'application/json')}>
          <Icon name="download" size={18} /> Download the unreadable data
        </button>
        <button className="btn" onClick={() => input.current?.click()}>
          <Icon name="upload" size={18} /> Restore from a backup file…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,application/zip,.json,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Start a fresh, empty cellar? The unreadable data will be replaced (download it first if you want to keep it).')) startFresh();
          }}
        >
          Start a fresh cellar
        </button>
      </div>
    </main>
  );
}

function Shell() {
  const { status, unavailableReason, retry, continueWithoutSaving } = useCellar();

  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        <span className="splash-glass" aria-hidden="true">
          <Icon name="cellar" size={36} />
        </span>
        Opening your cellar…
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <main className="main corrupt" id="main" tabIndex={-1}>
        <h1>Cellar Book can’t open its storage</h1>
        <p>
          This browser would not let Cellar Book read the place where your cellar is kept{unavailableReason ? ` (${unavailableReason})` : ''}. Your data may well still be there, so nothing has been changed and nothing will be saved over it.
        </p>
        <p>This often happens in a private window, or when the browser is blocking site data. Try again, or open Cellar Book in a normal window.</p>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={retry}>
            Try again
          </button>
          <button className="btn" onClick={continueWithoutSaving}>
            Continue without saving
          </button>
        </div>
      </main>
    );
  }

  if (status === 'corrupt') return <UnreadableScreen />;

  return (
    <div className="app">
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="cellar" size={22} />
          </span>
          Cellar Book
        </Link>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/wine/new" className="btn btn-primary btn-block">
          <Icon name="plus" size={18} /> Add wine
        </Link>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        <RouteEffects />
        <StatusBanners />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cellar" element={<Cellar />} />
          <Route path="/wine/new" element={<WineForm />} />
          <Route path="/wine/:id" element={<WineDetail />} />
          <Route path="/wine/:id/edit" element={<WineForm />} />
          <Route path="/layout" element={<Layout />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="home" /> <span>Home</span>
        </NavLink>
        <NavLink to="/cellar" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="cellar" /> <span>Cellar</span>
        </NavLink>
        <Link to="/wine/new" className="tab tab-add" aria-label="Add wine">
          <span className="tab-add-btn">
            <Icon name="plus" size={26} />
          </span>
        </Link>
        <NavLink to="/purchases" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="receipt" /> <span>Purchases</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <Icon name="settings" /> <span>Settings</span>
        </NavLink>
      </nav>
    </div>
  );
}

/** If something in the screens throws, the user still gets a way to save their cellar, not a blank page. */
function CrashScreen({ error }: { error: Error }) {
  const { data } = useCellar();
  return (
    <main className="main corrupt" id="main" tabIndex={-1}>
      <h1>Something went wrong on this screen</h1>
      <p>
        Your cellar has not been changed by this. Download a copy to be safe, then reload the page.
        <br />
        <span className="muted">{error.message}</span>
      </p>
      <div className="settings-actions">
        <button
          className="btn btn-primary"
          onClick={async () => {
            const file = await createBackupFile(data, false);
            downloadFile(file.filename, file.blob);
          }}
        >
          <Icon name="download" size={18} /> Download my cellar
        </button>
        <button className="btn" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    </main>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cellar Book crashed', error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}

function Root() {
  return (
    <CellarProvider>
      <ToastProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <Shell />
          </ErrorBoundary>
        </ConfirmProvider>
      </ToastProvider>
    </CellarProvider>
  );
}

// A data router (rather than <HashRouter>) so a half-filled form can stop you leaving it by accident.
const router = createHashRouter([{ path: '*', element: <Root /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
