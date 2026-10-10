import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  createTheme,
  Drawer,
  Input,
  Notification,
  Popover,
  Progress,
  Slider,
  Switch,
  TextInput,
  Title,
  type CSSVariablesResolver,
} from '@mantine/core';
import { Icon } from '../components/Icon';

/* Mantine configured to look like design/base.css. Each component gets the
   ui-* classes from components.css; screens pick a variant and never restyle.

   Variants:
   - Button: primary (default), secondary, danger, quiet, map (32px, on the room map)
   - ActionIcon: icon (default, 44px), map (32px map control), camera
   - Alert: info (default), warning, danger */

const fontFamily =
  "'DIN Next LT W05', 'Barlow', ui-sans-serif, system-ui, sans-serif";

export const theme = createTheme({
  fontFamily,
  headings: {
    fontFamily,
    fontWeight: '700',
    sizes: {
      h1: { fontSize: '1.75rem', lineHeight: '1.2', fontWeight: '700' },
      h2: { fontSize: '1.25rem', lineHeight: '1.2', fontWeight: '600' },
      h3: { fontSize: '1.25rem', lineHeight: '1.2', fontWeight: '600' },
    },
  },
  /* Design type scale: label 12, small 14, body 16, title 20, heading 28. */
  fontSizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.25rem',
    xl: '1.75rem',
  },
  lineHeights: { xs: '1.45', sm: '1.45', md: '1.45', lg: '1.2', xl: '1.2' },
  /* 4px grid. */
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },
  /* Controls 5px, cards 7px, sheets 8px. */
  radius: { xs: '5px', sm: '5px', md: '7px', lg: '8px', xl: '8px' },
  defaultRadius: 'sm',
  focusRing: 'auto',
  cursorType: 'pointer',
  respectReducedMotion: true,

  components: {
    Button: Button.extend({
      defaultProps: { variant: 'primary' },
      classNames: {
        root: 'ui-button',
        inner: 'ui-button-inner',
        label: 'ui-button-label',
        section: 'ui-button-section',
      },
    }),

    ActionIcon: ActionIcon.extend({
      defaultProps: { variant: 'icon' },
      classNames: { root: 'ui-icon-button' },
    }),

    Anchor: Anchor.extend({
      defaultProps: { underline: 'always' },
      classNames: { root: 'ui-anchor' },
    }),

    Card: Card.extend({
      defaultProps: { padding: 0 },
      classNames: { root: 'ui-card' },
    }),

    Badge: Badge.extend({
      classNames: {
        root: 'ui-chip',
        section: 'ui-chip-section',
        label: 'ui-chip-label',
      },
    }),

    Input: Input.extend({
      classNames: { input: 'ui-input', section: 'ui-input-section' },
    }),

    TextInput: TextInput.extend({
      defaultProps: { leftSectionWidth: 44 },
    }),

    Switch: Switch.extend({
      defaultProps: { labelPosition: 'left', withThumbIndicator: false },
      vars: () => ({
        root: {
          '--switch-height': '28px',
          '--switch-width': '48px',
          '--switch-thumb-size': '20px',
          '--switch-track-label-padding': '3px',
          '--switch-radius': '14px',
        },
      }),
      classNames: {
        root: 'ui-switch',
        body: 'ui-switch-body',
        labelWrapper: 'ui-switch-label-wrapper',
        label: 'ui-switch-label',
        input: 'ui-switch-input',
        track: 'ui-switch-track',
        thumb: 'ui-switch-thumb',
      },
    }),

    Slider: Slider.extend({
      defaultProps: { size: 'lg', thumbSize: 28, label: null },
      classNames: {
        root: 'ui-slider',
        thumb: 'ui-slider-thumb',
        mark: 'ui-slider-mark',
        markLabel: 'ui-slider-mark-label',
      },
    }),

    Progress: Progress.extend({
      defaultProps: { transitionDuration: 0 },
      classNames: { root: 'ui-progress', section: 'ui-progress-section' },
    }),

    Avatar: Avatar.extend({
      classNames: (_theme, props) => ({
        root: props.size === 'lg' ? 'ui-avatar ui-avatar--lg' : 'ui-avatar',
        placeholder:
          props.size === 'lg'
            ? 'ui-avatar-placeholder ui-avatar-placeholder--lg'
            : 'ui-avatar-placeholder',
      }),
    }),

    Alert: Alert.extend({
      defaultProps: { variant: 'info', role: 'status' },
      classNames: {
        root: 'ui-notice',
        wrapper: 'ui-notice-wrapper',
        icon: 'ui-notice-icon',
        body: 'ui-notice-body',
        title: 'ui-notice-title',
        message: 'ui-notice-message',
      },
    }),

    Notification: Notification.extend({
      defaultProps: {
        role: 'status',
        withBorder: true,
        closeButtonProps: {
          icon: <Icon name="close" />,
          'aria-label': 'Dismiss',
        },
      },
      classNames: {
        root: 'ui-banner',
        icon: 'ui-banner-icon',
        body: 'ui-banner-body',
        title: 'ui-banner-title',
        description: 'ui-banner-description',
        closeButton: 'ui-banner-close',
      },
    }),

    Popover: Popover.extend({
      defaultProps: { shadow: 'none' },
      classNames: { dropdown: 'ui-popover' },
    }),

    /* Decision sheet parts. Position and motion are set in DecisionSheet. */
    Drawer: Drawer.extend({
      classNames: {
        inner: 'ui-sheet-inner',
        overlay: 'ui-sheet-overlay',
        content: 'ui-sheet-content',
        body: 'ui-sheet-body',
        title: 'ui-sheet-title',
      },
    }),

    Title: Title.extend({
      classNames: { root: 'ui-title' },
    }),
  },
});

/* Point Mantine's own colour variables at the design tokens, so anything
   Mantine draws by default (body, text, dimmed, disabled, focus ring) matches. */
const tokenVariables = {
  '--mantine-color-body': 'var(--color-canvas)',
  '--mantine-color-text': 'var(--color-text)',
  '--mantine-color-dimmed': 'var(--color-text-muted)',
  '--mantine-color-placeholder': 'var(--color-text-muted)',
  '--mantine-color-anchor': 'var(--color-accent)',
  '--mantine-color-error': 'var(--color-danger)',
  '--mantine-color-default': 'var(--color-surface)',
  '--mantine-color-default-hover': 'var(--color-hover)',
  '--mantine-color-default-color': 'var(--color-text)',
  '--mantine-color-default-border': 'var(--color-border)',
  '--mantine-color-disabled': 'var(--color-surface-2)',
  '--mantine-color-disabled-color': 'var(--color-text-muted)',
  '--mantine-color-disabled-border': 'transparent',
  '--mantine-primary-color-filled': 'var(--color-focus)',
  '--mantine-primary-color-filled-hover': 'var(--color-accent)',
  '--mantine-primary-color-contrast': 'var(--color-on-accent)',
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: tokenVariables,
  dark: tokenVariables,
});
