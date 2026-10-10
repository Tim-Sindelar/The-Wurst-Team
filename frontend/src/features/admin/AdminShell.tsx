import { Link, NavLink, Outlet, useParams } from 'react-router';
import { Alert, Button, Title, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as queries from '../../api/generated/@tanstack/react-query.gen';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Icon } from '../../components/Icon';
import { adminHeaders, errorMessage } from './useAdminAction';
export function AdminShell() {
  return (
    <div className="admin-frame">
      <aside className="admin-sidebar">
        <Link to="/admin" className="grid gap-1 px-3 py-2">
          <strong className="text-title">Study Spaces</strong>
          <span className="text-label uppercase text-text-muted">Admin</span>
        </Link>
        <nav aria-label="Admin" className="grid gap-1">
          <NavLink end to="/admin" className="admin-nav">
            <Icon name="map" />
            Spaces
          </NavLink>
          <NavLink to="/admin/users" className="admin-nav">
            <Icon name="user" />
            Users
          </NavLink>
          <NavLink to="/admin/qr" className="admin-nav">
            <Icon name="qr" />
            QR codes
          </NavLink>
        </nav>
        <div className="mt-auto grid gap-2">
          <Link to="/" className="admin-nav">
            <Icon name="home" />
            Student app
          </Link>
          <div className="flex items-center justify-between px-3">
            <Text size="sm">Admin</Text>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
export function AdminSpaceShell() {
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
    <div className="grid gap-6">
      <Link to="/admin" className="flex items-center gap-2 text-text-muted">
        <Icon name="back" size="sm" />
        Spaces
      </Link>
      <header>
        <Title order={1}>{space.name}</Title>
        <Text c="dimmed">
          {space.is_archived ? 'Deleted' : space.is_open ? 'Open' : 'Closed'} ·{' '}
          {space.timezone}
        </Text>
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
      <Outlet context={space} />
    </div>
  );
}
