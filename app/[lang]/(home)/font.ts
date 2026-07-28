import localFont from 'next/font/local';

// Chakra Petch (OFL) — squared techno display face for the home page.
// Self-hosted subset (Latin + Vietnamese, ~14KB per weight) so VI
// tone-marked glyphs render and the build stays hermetic.
export const chakraPetch = localFont({
  src: [
    {
      path: './fonts/chakra-petch-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/chakra-petch-600.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-chakra',
  display: 'swap',
});
