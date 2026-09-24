import { useMemo } from 'react';
import { useAppSelector } from '../app/hooks.js';
import { useGetAllPropertiesQuery } from '../app/api/recordsApi.js';
import { useProjects } from '../app/api/projectsApi.js';
import {
  selectMapFilters, selectSelectedCity, selectMapLayers, selectDraftLeads,
  LAYER_KEYS, applyFilters,
} from '../app/slices/mapSlice.js';
import { buildLocations } from '../features/network/franchiseData.js';
import { mockLeadLocations } from '../features/network/mockLeads.js';

/**
 * The map's data, assembled from what the PMS already serves.
 *
 * NO NEW ENDPOINT. Two RTK Query endpoints that already exist carry
 * everything: `getProjects` (the network's nodes) and `getAllProperties` (the
 * p1 records, which hold the real on-site GPS captures). Adding a third
 * `/network/locations` endpoint would have meant a second server-side view of
 * the same rows, its own cache tag, and its own way to go stale — for data the
 * client already has in cache on most screens.
 *
 * The practical payoff: every existing invalidation already reaches this.
 * Approving a property or completing a stage busts `Project`/`Record`, so the
 * map updates with no extra wiring.
 *
 * @returns {{
 *   locations: Array<object>, filtered: Array<object>,
 *   isLoading: boolean, isError: boolean, refetch: function,
 *   counts: Record<string, number>
 * }}
 */
export function useFranchiseData() {
  const filters = useAppSelector(selectMapFilters);
  const selectedCity = useAppSelector(selectSelectedCity);
  const layers = useAppSelector(selectMapLayers);
  const includeAi = layers[LAYER_KEYS.AI];

  // 200 covers every project this business will have for years; the map is a
  // portfolio view, so paging it would just hide pins.
  const projectsQuery = useProjects({ limit: 200 });
  const propertiesQuery = useGetAllPropertiesQuery();

  const projects = projectsQuery.data?.data || projectsQuery.data || [];
  const properties = propertiesQuery.data || [];

  // Leads added in this session. They live in the slice rather than in RTK
  // Query cache because there is no create endpoint behind them yet.
  const draftLeads = useAppSelector(selectDraftLeads);

  /**
   * Three sources, one list: real PMS projects and properties, the sample
   * franchise leads, and anything added through the form this session.
   *
   * `mockLeadLocations()` is called inside the memo rather than at module
   * scope so it is not built on every render of every consumer; it is pure and
   * cheap, and this keeps its identity stable alongside the rest.
   */
  const locations = useMemo(
    () => buildLocations({
      projects,
      properties,
      includeAi,
      extra: [...mockLeadLocations(), ...draftLeads],
    }),
    [projects, properties, includeAi, draftLeads],
  );

  const filtered = useMemo(
    () => applyFilters(locations, filters, selectedCity),
    [locations, filters, selectedCity],
  );

  // Counts are of the UNFILTERED set on purpose: a filter chip reading
  // "Delayed (3)" has to keep saying 3 after you switch it off, or the number
  // vanishes the moment it becomes useful.
  const counts = useMemo(() => {
    const acc = { open: 0, lead: 0, delayed: 0, ai: 0 };
    for (const loc of locations) acc[loc.status] = (acc[loc.status] || 0) + 1;
    return acc;
  }, [locations]);

  const refetch = () => {
    projectsQuery.refetch?.();
    propertiesQuery.refetch?.();
  };

  return {
    locations,
    filtered,
    counts,
    isLoading: projectsQuery.isLoading || propertiesQuery.isLoading,
    isError: projectsQuery.isError || propertiesQuery.isError,
    refetch,
  };
}

export default useFranchiseData;
