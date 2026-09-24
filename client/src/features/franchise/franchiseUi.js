/** Presentation maps for the Franchise module — mirrors franchiseEnquiry.model.js. */

export const ENQUIRY_STATUS_META = {
  submitted: { label: 'Awaiting decision', color: '#D97706', soft: '#FEF3C7' },
  approved: { label: 'Approved', color: '#059669', soft: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', soft: '#FEE2E2' },
};

export const OWNERSHIP_LABEL = {
  owned: 'Owned',
  family: 'Family-owned',
  leased: 'Leased / can lease',
  other: 'Other',
};

/* Same rule as the HRMS apply link: pinned to the deployed site so the link
   the MD copies on localhost still opens on a prospect's phone. */
const SITE_URL = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');

/** The public enquiry form — what the expansion team shares with a prospect. */
export const franchiseEnquiryLink = () => `${SITE_URL || window.location.origin}/franchise/apply`;

/** A Google Maps link for the pin the applicant dropped, if any. */
export const mapsLinkFor = (location) => {
  if (Number.isFinite(location?.lat) && Number.isFinite(location?.lng)) {
    return `https://www.google.com/maps?q=${location.lat},${location.lng}`;
  }
  if (typeof location?.url === 'string' && location.url.trim()) {
    return location.url.trim();
  }
  if (typeof location?.mapUrl === 'string' && location.mapUrl.trim()) {
    return location.mapUrl.trim();
  }
  if (typeof location === 'string' && location.trim()) {
    return location.trim();
  }
  return null;
};
