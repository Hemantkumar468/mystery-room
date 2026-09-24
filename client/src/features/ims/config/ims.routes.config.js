import { lazy } from 'react';
import { LayoutDashboard, Warehouse, History, MapPin } from 'lucide-react';

/**
 * Single source of truth for the Inventory Management module — routing,
 * sidebar, breadcrumbs, titles and icons all read this one array via
 * lib/moduleRoutes.jsx, exactly as Purchase and HRMS do. Adding a screen is
 * one entry.
 *
 * WHY IMS IS ITS OWN MODULE rather than more pages under Master Data. The two
 * answer different questions for different people on different rhythms. The
 * catalogue says what a thing IS — set up once, corrected occasionally, owned
 * by whoever maintains the company's masters. The IMS says how many there ARE
 * — changing many times a day, per location, entered by whoever is standing at
 * the shelf. Folding the second into the first would have put a 1,322-row
 * catalogue in front of a technician who came to record six bulbs.
 *
 * They meet at the SKU: a stock row references a catalogue item and reads its
 * name, unit and price from it, so correcting a name in the master corrects it
 * everywhere and touches no count.
 */
export const imsRoutesConfig = [
  {
    key: 'ims-overview', path: '/ims/overview', parentKey: null,
    element: lazy(() => import('../ImsOverviewPage.jsx')),
    title: 'Overview', breadcrumb: 'Overview', icon: LayoutDashboard,
    sidebar: true, order: 0,
    description: 'What is running out, what moved today, and where it all sits.',
  },
  {
    key: 'ims-stock', path: '/ims/stock', parentKey: 'ims-overview',
    element: lazy(() => import('../StockPage.jsx')),
    title: 'Stock', breadcrumb: 'Stock', icon: Warehouse,
    sidebar: true, order: 1,
    description: 'How many of each item are at each location, against the safety level set for it.',
  },
  {
    key: 'ims-movements', path: '/ims/movements', parentKey: 'ims-overview',
    element: lazy(() => import('../MovementsPage.jsx')),
    title: 'Movements', breadcrumb: 'Movements', icon: History,
    sidebar: true, order: 2,
    description: 'Every receipt, issue, count and transfer — the append-only ledger the counts are derived from.',
  },
  {
    key: 'ims-locations', path: '/ims/locations', parentKey: 'ims-overview',
    element: lazy(() => import('../LocationsPage.jsx')),
    title: 'Locations', breadcrumb: 'Locations', icon: MapPin,
    sidebar: true, order: 3,
    description: 'The warehouse, the outlets and the franchise centres stock sits at.',
  },
];

export default imsRoutesConfig;
