import { MapPin, MousePointerClick } from 'lucide-react';
import { STATUS_META, STAGE_META } from '../../app/slices/mapSlice.js';

/**
 * Everything known about whatever the cursor is over, without clicking.
 *
 * The old hover was a name and a city in a small pill at the bottom of the
 * screen — which told you almost nothing and made you click every pin to find
 * out whether it was worth clicking. A map of sixty sites is only useful if
 * you can survey it by moving the mouse.
 *
 * TWO SHAPES, because the pins are two different things:
 *   • a LOCATION — one outlet, lead or site. Shows its full detail table, the
 *     same rows the click-through panel shows.
 *   • a CITY — the aggregate pin at country scope. Shows the status breakdown
 *     and what is actually inside it, which is the question a cluster raises.
 *
 * POSITIONING follows the cursor and flips near the edges, because a card
 * pinned to one corner makes you look away from the thing you are pointing at.
 * `pointer-events: none` on the card is load-bearing — without it the card
 * slides under the cursor, triggers mouseleave on the pin, and the whole thing
 * flickers itself out of existence.
 */

const CARD_W = 290;
const CARD_MAX_H = 340;
const OFFSET = 16;

/** Height of the header bar the card must never slide under. */
const HEADER_H = 54;
/** Height of the footer strip. */
const FOOTER_H = 46;

/** Keep the card inside the map, flipping side rather than being clipped. */
function place(point, box) {
  // No cursor yet — keep it off-screen rather than parking it at 0,0, which
  // is under the header and reads as a card stuck in the corner.
  if (!point || !box) return { left: -9999, top: -9999 };

  const flipX = point.x + OFFSET + CARD_W > box.width;
  const flipY = point.y + OFFSET + CARD_MAX_H > box.height - FOOTER_H;

  const left = flipX ? point.x - OFFSET - CARD_W : point.x + OFFSET;
  const top = flipY ? point.y - OFFSET - CARD_MAX_H : point.y + OFFSET;

  return {
    left: Math.min(Math.max(8, left), Math.max(8, box.width - CARD_W - 8)),
    // Clamped below the header: a pin near the top of the map would otherwise
    // put the card's own title behind the search bar.
    top: Math.min(Math.max(HEADER_H, top), Math.max(HEADER_H, box.height - FOOTER_H - 40)),
  };
}

function CityBody({ city }) {
  const members = city.members || [];
  return (
    <>
      <div className="mr-hover__row">
        <span className="mr-hover__label">Locations</span>
        <strong>{city.count}</strong>
      </div>

      {Object.entries(city.breakdown || {}).map(([key, n]) => {
        const meta = STATUS_META[key];
        if (!meta) return null;
        return (
          <div key={key} className="mr-hover__row">
            <span className="mr-hover__label">
              <span aria-hidden="true" className="mr-hover__dot" style={{ background: meta.color }} />
              {meta.label}
            </span>
            <strong>{n}</strong>
          </div>
        );
      })}

      {members.length > 0 && (
        <div className="mr-hover__list">
          <span className="mr-hover__label">In this city</span>
          {members.slice(0, 6).map((m) => (
            <span key={m.id} className="mr-hover__item">
              <span
                aria-hidden="true"
                className="mr-hover__dot"
                style={{ background: (STATUS_META[m.status] || STATUS_META.lead).color }}
              />
              {m.name}
            </span>
          ))}
          {/* Never silently truncate — a list that stops at six with no note
              reads as "there are six". */}
          {members.length > 6 && (
            <span className="mr-hover__more">{`+${members.length - 6} more`}</span>
          )}
        </div>
      )}
    </>
  );
}

function LocationBody({ location }) {
  return (
    <>
      {Number.isFinite(location.score) && (
        <div className="mr-hover__row">
          <span className="mr-hover__label">Progress</span>
          <strong>{`${location.score}%`}</strong>
        </div>
      )}

      {(location.details || []).map((d) => (
        <div key={d.label} className="mr-hover__row">
          <span className="mr-hover__label">{d.label}</span>
          <span className="mr-hover__value">{d.value}</span>
        </div>
      ))}

      <div className="mr-hover__row">
        <span className="mr-hover__label">Coordinates</span>
        <span className="mr-hover__value" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {`${location.coords.lat.toFixed(4)}, ${location.coords.lng.toFixed(4)}`}
        </span>
      </div>

      {/* The same honesty notices the details panel carries — a hover that
          hides them would let someone read a city-centre guess as a survey. */}
      {location.coordsSource === 'city' && location.kind !== 'suggestion' && (
        <div className="mr-hover__note">Placed at the city centre — no on-site GPS yet.</div>
      )}
      {location.coordsAdjustedForDisplay && (
        <div className="mr-hover__note">
          {`Nudged so all ${location.overlapCount} pins here can be clicked. Coordinates above are the real capture.`}
        </div>
      )}
      {location.isMock && (
        <div className="mr-hover__note">Sample lead — not yet a record in the PMS.</div>
      )}
    </>
  );
}

export function MapHoverCard({ item, kind, point, box }) {
  if (!item) return null;

  const isCity = kind === 'city';
  const status = isCity ? item.status : item.status;
  const meta = STATUS_META[status] || STATUS_META.lead;
  const stage = !isCity && item.stage ? STAGE_META[item.stage] : null;

  return (
    <div className="mr-hover" style={place(point, box)} role="tooltip" aria-live="polite">
      <div className="mr-hover__head">
        <strong className="mr-hover__title">{isCity ? item.city : item.name}</strong>
        <span className="mr-hover__badge" style={{ background: meta.color }}>{meta.label}</span>
      </div>

      <div className="mr-hover__sub">
        <MapPin size={11} />
        {isCity
          ? `${item.region || 'India'} · ${item.count} location${item.count === 1 ? '' : 's'}`
          : `${item.city}${item.region ? ` · ${item.region}` : ''}${stage ? ` · ${stage.label}` : ''}`}
      </div>

      <div className="mr-hover__body">
        {isCity ? <CityBody city={item} /> : <LocationBody location={item} />}
      </div>

      <div className="mr-hover__foot">
        <MousePointerClick size={11} />
        {isCity ? 'Click to open this city' : 'Click for the full record'}
      </div>
    </div>
  );
}

export default MapHoverCard;
