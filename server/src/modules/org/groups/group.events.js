import { ORG_EVENTS, onOrgEvent, emitOrgEvent } from '../org.events.js';

/** Group-deletion hooks — thin wrappers over the shared org event registry. */
export const onGroupDeleted = (fn) => onOrgEvent(ORG_EVENTS.GROUP_DELETED, fn);
export const emitGroupDeleted = (groupId) => emitOrgEvent(ORG_EVENTS.GROUP_DELETED, groupId);
