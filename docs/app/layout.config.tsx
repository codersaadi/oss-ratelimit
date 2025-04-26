import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 100 100" fill="none">
  <rect width="100" height="100" rx="20" fill="none"/>
  <g stroke="#38BDF8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="50,20 80,40 80,70 50,90 20,70 20,40" fill="#1E293B"/>
    <line x1="50" y1="20" x2="50" y2="90"/>
    <line x1="20" y1="40" x2="80" y2="70"/>
    <line x1="80" y1="40" x2="20" y2="70"/>
  </g>
</svg>

<span>
  OSS Ratelimit
</span>
      </>
    ),
  },
  // links: [
  //   {
  //     text: 'Documentation',
  //     url: '/docs',
  //     active: 'nested-url',
  //   },
  // ],
};
