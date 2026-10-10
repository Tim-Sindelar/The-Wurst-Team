import { useState } from 'react';
import { AppName } from '../../components/AppName';
import { AdminNoticeContext } from './AdminNoticeContext';
import { StatusBanner } from '../../components/StatusBanner';
import { AdminSpaceActionsContext } from './AdminSpaceActionsContext';
import { Link, NavLink, Outlet, useParams, useLocation } from 'react-router';
import { Alert, Avatar, Button, Title, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as queries from '../../api/generated/@tanstack/react-query.gen';
import { AdminThemeToggle } from './AdminThemeToggle';
import { Icon } from '../../components/Icon';
import { AdminStateChip } from './AdminStateChip';
import { adminHeaders, errorMessage } from './useAdminAction';
export function AdminShell() {
  const [notice, setNotice] = useState('');
  const { pathname } = useLocation();
  const inSpaces =
    pathname === '/admin' ||
    pathname === '/admin/new' ||
    pathname.startsWith('/admin/spaces/');
  return (
    <AdminNoticeContext.Provider value={{ notice, setNotice }}>
      <div className="admin-frame">
        <aside className="admin-sidebar">
          <Link to="/admin" className="admin-brand">
            <strong className="text-title">
              <AppName />
            </strong>
            <span className="text-label uppercase text-text-muted">Admin</span>
          </Link>
          <nav aria-label="Admin" className="admin-sidebar-nav">
            <Link
              to="/admin"
              className="admin-nav"
              aria-current={inSpaces ? 'page' : undefined}
            >
              <Icon name="map" />
              Spaces
            </Link>
            <NavLink to="/admin/users" className="admin-nav">
              <Icon name="user" />
              Users
            </NavLink>
            <NavLink to="/admin/qr" className="admin-nav">
              <Icon name="qr" />
              QR codes
            </NavLink>
          </nav>
          <div className="admin-sidebar-foot">
            <Link to="/" className="admin-nav">
              <Icon name="home" />
              Student app
            </Link>
            <div className="admin-sidebar-user">
              <Avatar radius="xl">AD</Avatar>
              <Text size="sm" className="flex-1">
                Admin
              </Text>
              <AdminThemeToggle />
            </div>
          </div>
        </aside>
        <main className="admin-content">
          <Outlet />
        </main>
        <StatusBanner
          placement="admin"
          opened={!!notice}
          onClose={() => setNotice('')}
          title="Updated"
          icon="check"
        >
          {notice}
        </StatusBanner>
      </div>
    </AdminNoticeContext.Provider>
  );
}
export function AdminSpaceShell() {
  const [actionsElement, setActionsElement] = useState<HTMLDivElement | null>(
    null,
  );
  const { spaceId } = useParams();
  const query = useQuery(
    queries.adminGetSpaceOverviewOptions({
      path: { space_id: spaceId! },
      headers: adminHeaders,
    }),
  );
  if (query.isPending) return <Text>Loading study place…</Text>;
  if (query.isError)
    return (
      <Alert variant="danger">
        {errorMessage(query.error)}{' '}
        <Button variant="quiet" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </Alert>
    );
  const space = query.data.space;
  return (
    <div className="admin-page">
      <Link to="/admin" className="admin-crumb">
        <Icon name="back" size="sm" />
        Spaces
      </Link>
      <header className="admin-page-header">
        <div>
          <Title order={1}>{space.name}</Title>
          <Text c="dimmed">
            <AdminStateChip
              label={
                space.is_archived
                  ? 'Deleted'
                  : space.is_open
                    ? 'Open'
                    : 'Closed'
              }
              tone={
                !space.is_archived && space.is_open ? 'free' : 'unavailable'
              }
            />{' '}
            · {space.timezone}
          </Text>
        </div>
        <div className="admin-header-actions">
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Refresh
          </Button>
          <div ref={setActionsElement} className="admin-header-actions" />
        </div>
      </header>
      <nav className="admin-tabs" aria-label="This space">
        {[
          ['seats', 'Seats'],
          ['hours', 'Opening hours'],
          ['closures', 'Closures'],
          ['layout', 'Layout'],
          ['qr', 'QR codes'],
          ['settings', 'Settings'],
        ].map(([path, title]) => (
          <NavLink key={path} to={'/admin/spaces/' + spaceId + '/' + path}>
            {title}
          </NavLink>
        ))}
      </nav>
      <AdminSpaceActionsContext.Provider value={actionsElement}>
        <Outlet context={space} />
      </AdminSpaceActionsContext.Provider>
    </div>
  );
}
