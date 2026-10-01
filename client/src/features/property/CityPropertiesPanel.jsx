import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { useGetPropertyQueueQuery } from '../../app/api/propertyCaptureApi.js';
import { decisionOnly } from './propertyUi.jsx';

/**
 * WHAT WE ALREADY HAVE IN THIS CITY.
 *
 * Shown under the city field on every form that starts something in a city —
 * New Store and Capture Property both — because the thing the person cannot
 * know from the form is what is already on the table where they are about to
 * write. A city is not one shop: Ahmedabad holds several locations and may
 * hold several stores, and somebody opening a second one there needs to see
 * the first before they name the third the same thing.
 *
 * GROUPED BY LOCATION, not listed flat. "Multiple locations in one city" is
 * the shape of the real problem — the question being answered is "what have we
 * got in Ahmedabad, and where in it?", and a flat list of twelve titles does
 * not answer the second half. The locations are the headings; the sites sit
 * under the one they belong to.
 *
 * IT NEVER BLOCKS. Nothing here stops a second store in a city or a second
 * site in a location, because both are ordinary: a city can carry a company
 * outlet and a franchise, and a store looks at ten shops before signing one.
 * This only makes the existing ones impossible to miss — see the deliberate
 * "NO DUPLICATE-CITY CHECK" note in NewProjectModal.
 */
const shortDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  : '');

const newestFirst = (list) => [...(list || [])]
  .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));

export function CityPropertiesPanel({ city, stores = null }) {
  const shown = String(city || '').trim();

  /* The queue already answers "what is in this city" and is filtered on the
     server, case-insensitively — so "bhopal" finds the rows filed as "BHOPAL".
     100 is well past any real city and keeps the whole answer in one request,
     which is what lets the list below be complete rather than a first six. */
  const { data, isFetching } = useGetPropertyQueueQuery(
    { city: shown, limit: 100 },
    { skip: !shown },
  );
  const rows = data?.rows || data?.data?.rows || [];

  /* A `demand` row is a store somebody asked for with no site against it yet —
     not a property. It is counted separately rather than listed, because a
     list of "New store — Ahmedabad" three times over says nothing about what
     is in Ahmedabad, while the count explains why the store picker above has
     more entries than this list has sites. */
  const properties = useMemo(() => newestFirst(rows.filter((r) => r.stage !== 'demand')), [rows]);
  const waiting = rows.length - properties.length;

  /* One group per location, newest location first — the same rule the lists
     themselves follow, so the place somebody filed this morning is at the top
     rather than wherever the alphabet put it. */
  const groups = useMemo(() => {
    const by = new Map();
    for (const r of properties) {
      const name = String(r.locality || '').trim();
      const key = name.toLowerCase() || '￿';
      if (!by.has(key)) by.set(key, { name, rows: [] });
      by.get(key).rows.push(r);
    }
    return [...by.values()];
  }, [properties]);

  if (!shown) return null;

  const otherStores = (stores || []).length;

  return (
    <div className="pcap-city">
      <span className="pcap-city-head">
        {isFetching && !rows.length ? `Looking at ${shown}…`
          : properties.length
            ? `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} already in ${shown}`
            + (groups.length > 1 ? ` across ${groups.length} locations` : '')
            : `Nothing captured in ${shown} yet — this is the first`}
      </span>

      {/* Why the store picker above may list more than this panel shows. */}
      {(otherStores > 1 || waiting > 0) && (
        <span className="pcap-city-stores">
          <Building2 size={12} />
          {otherStores > 1 && `${shown} already has ${otherStores} stores`}
          {otherStores > 1 && waiting > 0 && ' · '}
          {waiting > 0 && `${waiting} still waiting for a site`}
        </span>
      )}

      {groups.length > 0 && (
        <div className="pcap-city-scroll">
          {groups.map((g) => (
            <div className="pcap-city-group" key={g.name || '__none__'}>
              <span className="pcap-city-group-head">
                {g.name || 'Location not recorded'}
                <em>{g.rows.length}</em>
              </span>
              <ul className="pcap-city-list">
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <b>{r.title}</b>
                    <span>
                      {[
                        r.areaSqft ? `${Number(r.areaSqft).toLocaleString('en-IN')} sq ft` : null,
                        r.projectName,
                        shortDate(r.createdAt),
                      ].filter(Boolean).join(' · ')}
                    </span>
                    {/* NOT `r.stage` — where the MD routed somebody else's
                        site is the MD's business; the verdict is the only
                        part that is this filer's. */}
                    {(() => {
                      const v = decisionOnly(r);
                      return v ? <em className={`pcap-city-stage is-${v.cls}`}>{v.label}</em> : null;
                    })()}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CityPropertiesPanel;
