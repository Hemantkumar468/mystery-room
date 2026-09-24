/**
 * The Mystery Rooms game catalogue, transcribed from
 * SHEET/Games list with area requirement.xlsx ("Games list").
 *
 * This is the master every project picks from: Phase 3B chooses which games an
 * outlet will run, and Phase 10 installs them. It lives in the repo so a fresh
 * database seeds the same catalogue — `seedGames.js` loads it, and the Games
 * page (Master Data in the sidebar) maintains it from then on.
 *
 * WHY THE AREA IS A RANGE. Several games have more than one approved layout,
 * each needing a different area: Forgotten fits 532 sq ft in one plan and 716
 * in another. The sheet records those as extra rows under the game, so each is
 * kept as a `layout` with its own drawings, and the game carries the smallest
 * (`minAreaSqft`) with the sheet's stated maximum (`maxAreaSqft`). Space
 * planning needs the smallest that fits; drawings and procurement need the
 * particular option chosen.
 *
 * `pdfUrl` / `dwgUrl` are the Google Drive links exactly as the sheet gives
 * them — not re-hosted, so whoever owns that Drive stays in control. One DWG
 * is a bare filename rather than a link ("Conjuring- Option 2.dwg"); it is
 * kept verbatim rather than guessed at, and renders as text, not a link.
 *
 * Spelling is the sheet's own, including "Lokckout 2" — a master that silently
 * disagrees with the source document is worse than one with a visible typo.
 * Correct it on the Games page and the correction sticks.
 */

export const GAMES_MASTER = [
  {
    code: 'circus', name: 'Circus',
    minAreaSqft: 800, maxAreaSqft: 800,
    layouts: [
      { label: 'Option 1', areaSqft: 800, pdfUrl: 'https://drive.google.com/file/d/1C-5NwG1BZp37CU_KwlzO7XlLtf2BAd9h/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1GVF6gReSABqC_hhJB0yAFqKJaGjQniOb/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1X_2DyAQmtYZf__AQE2Jco9MI6AFv0Zhg/view?usp=drive_link',
    ],
  },
  {
    code: 'exorcism', name: 'Exorcism',
    minAreaSqft: 1010, maxAreaSqft: 1010,
    layouts: [
      { label: 'Option 1', areaSqft: 1010, pdfUrl: 'https://drive.google.com/file/d/1QwellJfL8kovA2vwlqC2ktcyaiAGEwvE/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1QVnyiqr7hbr7s5fcfJrWiL0AMvi92C2s/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1jznt4lh-HwN3sx0_mUR59-wvQqytqFGW/view?usp=drive_link',
    ],
  },
  {
    code: 'forgotten', name: 'Forgotten',
    minAreaSqft: 532, maxAreaSqft: 725,
    layouts: [
      { label: 'Option 1', areaSqft: 532, pdfUrl: 'https://drive.google.com/file/d/1LA7Xh6X8tfRIRUkWWkHpOplrvPs7e1LM/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1CqU4I5cLHVsUy1WSwoTDQa3LlTKxGEPd/view?usp=drive_link' },
      { label: 'Option 2', areaSqft: 716, pdfUrl: 'https://drive.google.com/file/d/1SJGXvSDe5cXna4cTb1kYL5K6WyRVoqZu/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1fUHx46i_ts7E5DHCyGnjX0o3qkTLU0KE/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1QZ3qk2ktdaUy7nOfZL_18zd-fsGa3mpk/view?usp=drive_link',
    ],
  },
  {
    code: 'mummy', name: 'Mummy',
    minAreaSqft: 480, maxAreaSqft: 550,
    layouts: [
      { label: 'Option 1', areaSqft: 480, pdfUrl: 'https://drive.google.com/file/d/1-znAkxXWp-ydMJMrzGztZRSaVMdmVW8t/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1phkzCu147eue9hPSLsWcPmn9vjHdGuwG/view?usp=drive_link' },
      { label: 'Option 2', areaSqft: 527, pdfUrl: 'https://drive.google.com/file/d/1AmJD5w619c1PhmcaEDPGgk5UtMdmfDaA/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1IlGBEDTPCNntt01_n41Jvc5uAalmPyvA/view?usp=drive_link' },
    ],
  },
  {
    code: 'paranormal', name: 'Paranormal',
    minAreaSqft: 662, maxAreaSqft: 700,
    layouts: [
      { label: 'Option 1', areaSqft: 677, pdfUrl: 'https://drive.google.com/file/d/13hEO2DmIL8zw2AuJ3BaZNRGpcch-1Dsf/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/13fVkYmgsH2IYRUSveqHrKujYAyePjRfD/view?usp=drive_link' },
      { label: 'Option 2', areaSqft: 662, pdfUrl: 'https://drive.google.com/file/d/1kjpLp6XuJtif2W2HwFApSr1WbhBfP8hQ/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1iblFZd6GkBw--FxDDP8sK19JNdSIv8mN/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1J7WNY3ulZD4iGnNxIEggoAKTyMmVWRHO/view?usp=drive_link',
    ],
  },
  {
    code: 'photographer', name: 'Photographer',
    minAreaSqft: 862, maxAreaSqft: 875,
    layouts: [
      { label: 'Option 1', areaSqft: 862, pdfUrl: 'https://drive.google.com/file/d/1HfY16ajJzwVznoIhVdoO7A4biMgspp4h/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1UGO0N0CUTtlINLUELJPwq-n4_mO5kuve/view?usp=drive_link' },
    ],
  },
  {
    code: 'ring', name: 'Ring',
    minAreaSqft: 723, maxAreaSqft: 725,
    layouts: [
      { label: 'Option 1', areaSqft: 723, pdfUrl: 'https://drive.google.com/file/d/1rGZlSc2uwpTqXDqQ2-ZumNnwuE8s1EFr/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1DU_c3ecA-YxXSqJn__Gua9Nn2cTnsQld/view?usp=drive_link' },
    ],
  },
  {
    code: 'school-of-magic', name: 'School of magic',
    minAreaSqft: 564, maxAreaSqft: 625,
    layouts: [
      { label: 'Option 1', areaSqft: 564, pdfUrl: 'https://drive.google.com/file/d/1tTpFXzFYDe3tXWvNpgDWujMflSV3rKTu/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1y-uzRS1tS4xn8YKc7n6dSiKP-gotB7w-/view?usp=drive_link' },
      { label: 'Option 2', areaSqft: 613, pdfUrl: 'https://drive.google.com/file/d/1iUnvK3QO2x9xzbxwxc9SPyJ1hnfOl9nV/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1YukekY-6CUjv-A5l7-8NL6T7G4XPY_iQ/view?usp=drive_link' },
    ],
  },
  {
    code: 'bhangarh', name: 'Bhangarh',
    minAreaSqft: 444, maxAreaSqft: 450,
    layouts: [
      { label: 'Option 1', areaSqft: 444, pdfUrl: 'https://drive.google.com/file/d/11Tj8-LHYyu6xMFF4fhIP4hFu_0UqCgf4/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1Rp7I23B5cVAyekeTil9j5_iQFCMy_3cd/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1bf02WulVDwpEqr9rPNdx-RjVyBNgyQnV/view?usp=drive_link',
    ],
  },
  {
    code: 'conjuring', name: 'Conjuring',
    minAreaSqft: 581, maxAreaSqft: 625,
    layouts: [
      { label: 'Option 1', areaSqft: 617, pdfUrl: 'https://drive.google.com/file/d/1ktjv3D4GtJTSLmgCBT_VfkkUgksTkKR5/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1SywCDCzLu6EOJpidXQOfkL_eaTu8C8eR/view?usp=drive_link' },
      { label: 'Option 2', areaSqft: 581, pdfUrl: 'https://drive.google.com/file/d/1XqUap3J1EO0cA9WcLdP3kG2TclKUpN0y/view?usp=drive_link', dwgUrl: 'Conjuring- Option 2.dwg' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/17TaLDIPP396oTKat0Q_DekAyV4kPJozV/view?usp=drive_link',
    ],
  },
  {
    code: 'hurt-locker', name: 'Hurt Locker',
    minAreaSqft: 291, maxAreaSqft: 300,
    layouts: [
      { label: 'Option 1', areaSqft: 291, pdfUrl: 'https://drive.google.com/file/d/1-b3ZfIjVafGtHbJ1SrSm0URN1zldRirS/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1ugjPppGdv4OW7TGJnQo0xRVZxjyZjhU9/view?usp=drive_link' },
    ],
  },
  {
    code: 'inferno', name: 'Inferno',
    minAreaSqft: 282, maxAreaSqft: 300,
    layouts: [
      { label: 'Option 1', areaSqft: 282, pdfUrl: 'https://drive.google.com/file/d/1AI4Q2IPVzg4u-MT5-Cp1BUOQT0mHweIQ/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1oIsp5YOjQCqWVwgTCXUmlN3g98iBdbO4/view?usp=drive_link' },
    ],
  },
  {
    code: 'kohinoor', name: 'Kohinoor',
    minAreaSqft: 412, maxAreaSqft: 425,
    layouts: [
      { label: 'Option 1', areaSqft: 412, pdfUrl: 'https://drive.google.com/file/d/1kP8vYFI-w_cF71PJ-v8py4aGFeYBP6bC/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1Nsk-Vpa6_2IJcIpBPqibFX5EkmaD7vag/view?usp=drive_link' },
    ],
  },
  {
    code: 'lokckout-2', name: 'Lokckout 2',
    minAreaSqft: 344, maxAreaSqft: 350,
    layouts: [
      { label: 'Option 1', areaSqft: 344, pdfUrl: 'https://drive.google.com/file/d/1f7lYixJp3NkP0nFLw9NHFr71OqEE7tSE/view?usp=drive_link', dwgUrl: 'https://drive.google.com/file/d/1Ky-FggZhYCrmQ73XSK-R5zOmKFH36jFY/view?usp=drive_link' },
    ],
    extraDrawings: [
      'https://drive.google.com/file/d/1UAa7XFmnK6DL850O5CdU9JscG8420hhD/view?usp=drive_link',
    ],
  },
];

export default GAMES_MASTER;
