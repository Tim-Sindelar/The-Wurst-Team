import { NavLink, useLocation } from 'react-router';
import { paths } from '../routes';
import { socialEnabled } from '../features';
import { Icon } from './Icon';

/** The shell keeps navigation separate from scrolling content and actions. */
export function BottomNavigation() {
  const { pathname } = useLocation();
  return (
    <nav className="ui-bottom-nav" aria-label="Main navigation">
      <div className="mx-auto grid w-full max-w-phone auto-cols-fr grid-flow-col">
        <NavLink to={paths.home} end className="ui-bottom-nav-link">
          <Icon name="home" />
          <span>Home</span>
        </NavLink>
        <NavLink to={paths.map} className="ui-bottom-nav-link">
          <Icon name="map" />
          <span>Map</span>
        </NavLink>
        {socialEnabled && (
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
        )}
        <NavLink to={paths.profile} className="ui-bottom-nav-link">
          <Icon name="user" />
          <span>Profile</span>
        </NavLink>
      </div>
    </nav>
  );
}
