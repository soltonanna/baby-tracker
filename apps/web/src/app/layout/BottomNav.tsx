import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
}

const ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: '☀' },
  { to: '/timeline', labelKey: 'nav.timeline', icon: '☰' },
  { to: '/health', labelKey: 'nav.health', icon: '✚' },
  { to: '/more', labelKey: 'nav.more', icon: '⋯' },
];

/**
 * Fixed bottom navigation: reachable with a thumb, padded for the home
 * indicator on phones with a safe area.
 */
export function BottomNav() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('app.name')}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-screen-sm">
        {ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-touch flex-col items-center justify-center gap-0.5 py-2',
                  'text-xs transition-colors',
                  isActive ? 'text-accent' : 'text-muted',
                ].join(' ')
              }
            >
              <span aria-hidden="true" className="text-lg leading-none">
                {item.icon}
              </span>
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
