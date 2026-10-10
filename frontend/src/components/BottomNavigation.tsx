import { NavLink, useLocation } from 'react-router';
import { paths } from '../routes';
import { Icon } from './Icon';

/** Development trial; the shell keeps this separate from scrolling content and actions. */
export function BottomNavigation() {
  const { pathname } = useLocation();
  return (
    <nav className="ui-bottom-nav" aria-label="Main navigation">
      <div className="mx-auto grid w-full max-w-phone grid-cols-3">
        <NavLink to={paths.home} end className="ui-bottom-nav-link">
          <Icon name="home" />
          <span>Home</span>
        </NavLink>
        <NavLink to={paths.map} className="ui-bottom-nav-link">
          <Icon name="map" />
          <span>Map</span>
        </NavLink>
        <NavLink
          to="/social-draft"
          className="ui-bottom-nav-link"
          aria-current={
            pathname.startsWith('/social-draft') ? 'page' : undefined
          }
        >
          <Icon name="friends" />
          <span>Friends</span>
        </NavLink>
      </div>
    </nav>
  );
}
