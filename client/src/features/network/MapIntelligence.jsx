import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, X, Radar, Search, MapPin, AlertTriangle, ArrowRight, Building2, RefreshCw,
  MessageCircleQuestion, SendHorizonal, Plus, History, Trash2,
} from 'lucide-react';
import {
  useMarketScout, useExpansionRadar,
  useGetMapChatsQuery, useGetMapChatQuery,
  useCreateMapChatMutation, useSendMapChatMessageMutation, useDeleteMapChatMutation,
} from '../../app/api/aiApi.js';
import { fromNow } from '../../lib/format.js';
import { cityCoord } from './cityCoords.js';

/**
 * The map's business brain — the panel behind the ✨ Intelligence button.
 *
 * Three instruments, all answering questions an MD actually asks while
 * looking at the network:
 *
 *   ASK              A saved conversation with a research analyst. Every
 *                    thread is persisted server-side (mapChat.service.js),
 *                    has its own URL (?chat=…), and hands its history back
 *                    to the model — so follow-ups are answered in context
 *                    and facts already researched in the thread are reused
 *                    instead of searched for again.
 *
 *   MARKET SCOUT     "Should we open in <city>?" — a grounded research
 *                    dossier: demand, named competitors, micro-markets,
 *                    rent reality, risks, verdict.
 *
 *   EXPANSION RADAR  "Where next?" — AI ranks the next six cities against
 *                    the network we already have.
 *
 * Plus the CATCHMENT CHECK: pure geometry, no AI — the distance from a
 * selected pin to the nearest existing centre, flagged under 3 km.
 */

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km — accurate to well under 1% at city scale. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(s));
}

/** The nearest OTHER network unit to a location, and how far. */
export function nearestUnit(location, locations) {
  if (!location?.coords) return null;
  let best = null;
  for (const other of locations) {
    if (other.id === location.id || !other.coords) continue;
    if (other.kind !== 'project') continue; // centres, not other candidates
    const km = distanceKm(location.coords, other.coords);
    if (!best || km < best.km) best = { unit: other, km };
  }
  return best;
}

const RATING_META = {
  strong: { label: 'Strong market', color: 'var(--success)' },
  promising: { label: 'Promising', color: 'var(--primary)' },
  cautious: { label: 'Proceed with caution', color: 'var(--warning)' },
  avoid: { label: 'Not now', color: 'var(--danger)' },
};

const CONFIDENCE_META = {
  high: { label: 'High confidence', color: 'var(--success)' },
  medium: { label: 'Likely — verify', color: 'var(--warning)' },
  low: { label: 'Best-effort research', color: 'var(--text-subtle)' },
};

/** Question ideas that adapt to what the user is looking at. */
const askChips = (selected, selectedCity) => [
  selected ? `Are there any escape rooms or similar game concepts within 5 km of ${selected.name}?` : null,
  selected ? `Is any of our own centres near ${selected.name}?` : null,
  selectedCity && !selected ? `Which malls in ${selectedCity} have the best footfall for us?` : null,
  'Where are we paying the highest rent per sq ft?',
  'Which of our cities has no competitor at all?',
].filter(Boolean).slice(0, 3);

/** Findings of the LAST assistant message — what the map should be showing. */
const latestFindings = (chat) => {
  const last = [...(chat?.messages || [])].reverse().find((m) => m.role === 'assistant');
  return last?.findings || [];
};

function ScoutDossier({ scout }) {
  const meta = RATING_META[scout.rating] || RATING_META.promising;
  return (
    <div className="mi-dossier">
      <div className="mi-rating" style={{ '--tone': meta.color }}>
        <b>{meta.label}</b> — {scout.headline}
      </div>

      <h4>Demand</h4>
      <p>{scout.demand}</p>

      {scout.micro_markets?.length > 0 && (
        <>
          <h4>Where to scout first</h4>
          <ul className="mi-list">
            {scout.micro_markets.map((m) => (
              <li key={m.area}><b>{m.area}</b> — {m.why}</li>
            ))}
          </ul>
        </>
      )}

      {scout.competitors?.length > 0 && (
        <>
          <h4>Competition on the ground</h4>
          <ul className="mi-list">
            {scout.competitors.map((c) => (
              <li key={c.name}><b>{c.name}</b> — {c.note}</li>
            ))}
          </ul>
        </>
      )}

      <h4>Rent reality</h4>
      <p>{scout.rent_reality}</p>

      {scout.risks?.length > 0 && (
        <>
          <h4>Risks</h4>
          <ul className="mi-list mi-list--risk">
            {scout.risks.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </>
      )}

      <div className="mi-verdict">
        <span className="mi-verdict-label">Verdict</span>
        {scout.verdict}
      </div>
      <span className="tiny muted">AI research, grounded with live web search — verify on the ground before signing anything.</span>
    </div>
  );
}

/** One assistant reply: the answer, its confidence, its findings, its caveat. */
function AssistantBubble({ msg, onFocusFinding }) {
  const conf = CONFIDENCE_META[msg.confidence] || null;
  return (
    <div className="mi-msg mi-msg--ai">
      {conf && <span className="mi-conf" style={{ '--tone': conf.color }}>{conf.label}</span>}
      <p className="mi-answer">{msg.text}</p>
      {msg.findings?.length > 0 && (
        <ul className="mi-list mi-findings">
          {msg.findings.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <b>{f.name}</b>{f.approx ? ' (approx.)' : ''} — {f.detail}
              {Number.isFinite(f.lat) && Number.isFinite(f.lng) && (
                <button type="button" className="mi-fly" onClick={() => onFocusFinding?.(f)}>
                  See on map <ArrowRight size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg.caveat && <p className="mi-watch"><AlertTriangle size={11} /> {msg.caveat}</p>}
    </div>
  );
}

/**
 * The Ask tab: a persisted conversation.
 *
 * The thread scrolls; the composer never leaves the bottom — the follow-up
 * box being "gone" after the first answer was the original design's real bug.
 */
function AskChat({ chatId, onChatChanged, selected, selectedCity, onFindings, onFocusFinding }) {
  const [chat, setChat] = useState(null);
  const [question, setQuestion] = useState('');
  const [histOpen, setHistOpen] = useState(false);
  const [error, setError] = useState(null);
  const threadRef = useRef(null);

  const [createChat, creating] = useCreateMapChatMutation();
  const [sendMessage, sending] = useSendMapChatMessageMutation();
  const [deleteChat] = useDeleteMapChatMutation();
  const busy = creating.isLoading || sending.isLoading;

  // A chat named in the URL (or picked from history) loads from the server.
  const { data: loadedChat } = useGetMapChatQuery(chatId, {
    skip: !chatId || chat?._id === chatId,
  });
  useEffect(() => {
    if (loadedChat && loadedChat._id !== chat?._id) {
      setChat(loadedChat);
      onFindings?.(latestFindings(loadedChat));
    }
  }, [loadedChat, chat, onFindings]);

  const { data: chatList } = useGetMapChatsQuery(undefined, { skip: !histOpen });

  // Stay pinned to the newest exchange.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages?.length, busy]);

  const send = async (preset) => {
    const text = (preset || question).trim();
    if (!text || busy) return;
    setError(null);
    setHistOpen(false);
    try {
      const out = chat
        ? await sendMessage({ id: chat._id, question: text, focus: focusOf() }).unwrap()
        : await createChat({ question: text, focus: focusOf() }).unwrap();
      setChat(out);
      setQuestion('');
      onFindings?.(latestFindings(out));
      onChatChanged?.(out._id);
    } catch (e) {
      setError(e?.data?.message || 'The research could not finish — try again.');
    }
  };
  const focusOf = () => (selected
    ? { name: selected.name, city: selected.city, ...(selected.coords || {}) }
    : selectedCity ? { city: selectedCity } : undefined);

  const newChat = () => {
    setChat(null);
    setQuestion('');
    setError(null);
    setHistOpen(false);
    onFindings?.([]);
    onChatChanged?.(null);
  };
  const openChat = (id) => {
    setHistOpen(false);
    if (id === chat?._id) return;
    setChat(null);
    onChatChanged?.(id);
  };
  const removeChat = async (id, e) => {
    e.stopPropagation();
    await deleteChat(id).unwrap().catch(() => {});
    if (id === chat?._id) newChat();
  };

  return (
    <div className="mi-chat">
      <div className="mi-chat-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistOpen((v) => !v)} aria-expanded={histOpen}>
          <History size={13} /> Previous
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={newChat}>
          <Plus size={13} /> New chat
        </button>
        {(selected || selectedCity) && !histOpen && (
          <span className="mi-focus" style={{ marginLeft: 'auto' }}><MapPin size={11} /> <b>{selected?.name || selectedCity}</b></span>
        )}
      </div>

      {histOpen ? (
        <div className="mi-thread" ref={threadRef}>
          {(chatList || []).length === 0 && <p className="tiny muted">No saved conversations yet — every chat is kept, with its own link.</p>}
          <ul className="mi-chatlist">
            {(chatList || []).map((c) => (
              <li key={c._id}>
                <button type="button" className={`mi-chatrow${c._id === chat?._id ? ' is-on' : ''}`} onClick={() => openChat(c._id)}>
                  <span className="mi-chatrow-title">{c.title}</span>
                  <span className="tiny muted">{fromNow(c.updatedAt)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}</span>
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Delete conversation" onClick={(e) => removeChat(c._id, e)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mi-thread" ref={threadRef}>
          {!chat && (
            <>
              <p className="tiny muted" style={{ margin: 0 }}>
                Ask anything about the network or the market around it. Your own data answers exactly; the live web answers the rest. Every conversation is saved — follow-ups reuse what this thread already researched.
              </p>
              <div className="mi-chips">
                {askChips(selected, selectedCity).map((c) => (
                  <button type="button" key={c} className="mi-chip" onClick={() => send(c)}>{c}</button>
                ))}
              </div>
            </>
          )}
          {(chat?.messages || []).map((m, i) => (
            m.role === 'user'
              ? <div key={i} className="mi-msg mi-msg--me">{m.text}</div>
              : <AssistantBubble key={i} msg={m} onFocusFinding={onFocusFinding} />
          ))}
          {busy && <div className="mi-msg mi-msg--ai mi-msg--thinking">Researching — your data first, then the live web…</div>}
          {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
          {chat && <span className="tiny muted">Violet pins on the map are the latest answer's findings — dashed means approximate.</span>}
        </div>
      )}

      <div className="mi-composer">
        <input
          className="pt-select"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={chat ? 'Ask a follow-up…' : 'e.g. Any escape rooms within 5 km of this centre?'}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          disabled={busy}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={!question.trim() || busy} onClick={() => send()} aria-label="Send">
          <SendHorizonal size={13} />
        </button>
      </div>
    </div>
  );
}

export function MapIntelligence({
  open, onClose, selectedCity, locations, selected, onFlyToCity,
  onFindings, onFocusFinding, chatId, onChatChanged,
}) {
  const [tab, setTab] = useState('ask');
  const [city, setCity] = useState('');
  const scoutCity = (city || selectedCity || '').trim();

  const scout = useMarketScout();
  const radar = useExpansionRadar();
  const [scoutResult, setScoutResult] = useState(null);
  const [radarResult, setRadarResult] = useState(null);
  const [error, setError] = useState(null);

  // The catchment check — free, instant, always on when a pin is selected.
  const proximity = useMemo(
    () => (selected ? nearestUnit(selected, locations) : null),
    [selected, locations],
  );

  // Every city the network already touches, for the datalist.
  const knownCities = useMemo(
    () => [...new Set(locations.map((l) => l.city).filter(Boolean))].sort(),
    [locations],
  );

  const runScout = async () => {
    if (!scoutCity) return;
    setError(null);
    try {
      setScoutResult(await scout.mutateAsync({ city: scoutCity }));
    } catch (e) {
      setError(e?.response?.data?.message || 'The scout could not finish — try again.');
    }
  };
  const runRadar = async (force = false) => {
    setError(null);
    try {
      setRadarResult(await radar.mutateAsync(force ? { force: true } : {}));
    } catch (e) {
      setError(e?.response?.data?.message || 'The radar could not finish — try again.');
    }
  };

  if (!open) return null;

  return (
    <div className="mi-panel" data-guide="map-intelligence">
      <div className="mi-head">
        <span className="mi-title"><Sparkles size={15} /> Intelligence</span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close intelligence panel">
          <X size={14} />
        </button>
      </div>

      <div className="mi-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'ask'} className={tab === 'ask' ? 'is-on' : ''} onClick={() => setTab('ask')}>
          <MessageCircleQuestion size={13} /> Ask
        </button>
        <button type="button" role="tab" aria-selected={tab === 'scout'} className={tab === 'scout' ? 'is-on' : ''} onClick={() => setTab('scout')}>
          <Search size={13} /> Market Scout
        </button>
        <button type="button" role="tab" aria-selected={tab === 'radar'} className={tab === 'radar' ? 'is-on' : ''} onClick={() => setTab('radar')}>
          <Radar size={13} /> Expansion Radar
        </button>
      </div>

      {proximity && (
        <div className={`mi-proximity mi-proximity--bar${proximity.km < 3 ? ' is-close' : ''}`}>
          {proximity.km < 3 ? <AlertTriangle size={13} /> : <MapPin size={13} />}
          <span>
            Nearest centre: <b>{proximity.unit.name}</b> — <b>{proximity.km < 10 ? proximity.km.toFixed(1) : Math.round(proximity.km)} km</b>
            {proximity.km < 3 && ' · same catchment — these two would eat each other\'s footfall'}
          </span>
        </div>
      )}

      {tab === 'ask' ? (
        <AskChat
          chatId={chatId}
          onChatChanged={onChatChanged}
          selected={selected}
          selectedCity={selectedCity}
          onFindings={onFindings}
          onFocusFinding={onFocusFinding}
        />
      ) : (
        <div className="mi-body">
          {tab === 'scout' && (
            <div className="col gap-2">
              <p className="tiny muted" style={{ margin: 0 }}>
                A researched answer to “should we open here?” — demand, named competitors, the areas worth walking, real rents, a verdict.
              </p>
              <div className="row gap-2">
                <input
                  className="pt-select"
                  style={{ flex: 1, minWidth: 0 }}
                  list="mi-cities"
                  placeholder={selectedCity ? `City… (${selectedCity})` : 'City — e.g. Indore'}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runScout(); }}
                />
                <datalist id="mi-cities">
                  {knownCities.map((c) => <option key={c} value={c} />)}
                </datalist>
                <button type="button" className="btn btn-primary btn-sm" disabled={!scoutCity || scout.isLoading || scout.isPending} onClick={runScout}>
                  {scout.isLoading || scout.isPending ? 'Researching…' : 'Scout'}
                </button>
              </div>
              {(scout.isLoading || scout.isPending) && (
                <span className="tiny muted">Reading the live web for {scoutCity} — competitors, malls, rents. Usually 15–30 seconds.</span>
              )}
              {scoutResult && !scout.isLoading && !scout.isPending && (
                <>
                  <div className="mi-scout-city"><Building2 size={13} /> {scoutResult.city}
                    {scoutResult.ours?.our_projects?.length > 0 && (
                      <span className="tiny muted"> · we already have {scoutResult.ours.our_projects.length} project{scoutResult.ours.our_projects.length === 1 ? '' : 's'} here</span>
                    )}
                  </div>
                  <ScoutDossier scout={scoutResult} />
                </>
              )}
            </div>
          )}

          {tab === 'radar' && (
            <div className="col gap-2">
              <p className="tiny muted" style={{ margin: 0 }}>
                The next six cities to open, ranked against the centres you already have — grounded in live market research.
              </p>
              <div className="row gap-2">
                <button type="button" className="btn btn-primary btn-sm" disabled={radar.isLoading || radar.isPending} onClick={() => runRadar(false)}>
                  <Radar size={13} /> {radar.isLoading || radar.isPending ? 'Scanning…' : radarResult ? 'Scan again' : 'Where should we open next?'}
                </button>
                {radarResult?.cached && (
                  <button type="button" className="btn btn-ghost btn-sm" title="Ignore the cached answer and research afresh" onClick={() => runRadar(true)}>
                    <RefreshCw size={12} /> Fresh
                  </button>
                )}
              </div>
              {(radar.isLoading || radar.isPending) && (
                <span className="tiny muted">Weighing your network against live market data. Usually 15–30 seconds.</span>
              )}
              {radarResult && !radar.isLoading && !radar.isPending && (
                <>
                  <p className="mi-reading">{radarResult.reading}</p>
                  <ol className="mi-radar-list">
                    {(radarResult.cities || []).map((c) => (
                      <li key={c.city}>
                        <div className="mi-radar-head">
                          <b>{c.city}</b><span className="tiny muted">{c.state}</span>
                          <span className="mi-score" title="Attractiveness for the next opening">{Math.round(c.score)}</span>
                        </div>
                        <div className="mi-scorebar"><span style={{ width: `${Math.min(100, Math.max(4, c.score))}%` }} /></div>
                        <p>{c.why}</p>
                        <p className="mi-watch"><AlertTriangle size={11} /> {c.watch_out}</p>
                        {c.anchor_areas?.length > 0 && <p className="tiny muted">Scout first: {c.anchor_areas.join(' · ')}</p>}
                        {cityCoord(c.city) && (
                          <button type="button" className="mi-fly" onClick={() => onFlyToCity?.(c.city)}>
                            See on map <ArrowRight size={11} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  <span className="tiny muted">{radarResult.cached ? 'From the last scan — the answer only moves when your network does.' : 'Fresh scan.'} Verify on the ground before committing.</span>
                </>
              )}
            </div>
          )}

          {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
        </div>
      )}
    </div>
  );
}

export default MapIntelligence;
