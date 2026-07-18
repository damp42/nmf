// NoMoreForms — shared field definitions
// Single source of truth for the NMF namespace. Loaded by both the form and app
// pages via <script src="/shared/fields.js"></script>. No modules — these are globals.

// NMF namespace → display metadata
const NMF_FIELDS = {
  'me:identity:name:first':            { label: 'First Name',             group: 'Identity',  sensitivity: 'standard' },
  'me:identity:name:last':             { label: 'Last Name',              group: 'Identity',  sensitivity: 'standard' },
  'me:identity:name:full':             { label: 'Full Name',              group: 'Identity',  sensitivity: 'standard' },
  'me:identity:dob':                   { label: 'Date of Birth',          group: 'Identity',  sensitivity: 'standard' },
  'me:identity:ssn:last4':             { label: 'SSN (last 4)',           group: 'Identity',  sensitivity: 'sensitive' },
  'me:contact:email:primary':          { label: 'Email Address',          group: 'Contact',   sensitivity: 'standard' },
  'me:contact:phone:mobile':           { label: 'Mobile Phone',           group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:street':         { label: 'Street Address',         group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:city':           { label: 'City',                   group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:state':          { label: 'State',                  group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:zip':            { label: 'ZIP Code',               group: 'Contact',   sensitivity: 'standard' },
  'me:health:insurance:provider':      { label: 'Insurance Provider',     group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:insurance:member_id':     { label: 'Member ID',              group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:insurance:group_id':      { label: 'Group ID',               group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:emergency_contact:name':  { label: 'Emergency Contact Name', group: 'Emergency', sensitivity: 'standard' },
  'me:health:emergency_contact:phone': { label: 'Emergency Contact Phone',group: 'Emergency', sensitivity: 'standard' },
};

// Named bundles — predefined field groupings
const NMF_BUNDLES = {
  'bundle:patient_intake': [
    'me:identity:name:full',
    'me:identity:dob',
    'me:contact:address:street',
    'me:contact:address:city',
    'me:contact:address:state',
    'me:contact:address:zip',
    'me:contact:phone:mobile',
    'me:contact:email:primary',
    'me:health:insurance:provider',
    'me:health:insurance:member_id',
    'me:health:insurance:group_id',
    'me:health:emergency_contact:name',
    'me:health:emergency_contact:phone',
  ],
};

function resolveFields(requested) {
  const resolved = [];
  for (const f of requested) {
    if (NMF_BUNDLES[f]) resolved.push(...NMF_BUNDLES[f]);
    else resolved.push(f);
  }
  return [...new Set(resolved)];
}

// Composite (aggregate) fields. Granting one shares ALL its constituent values,
// not just the field itself — the receiver decides which to persist.
// me:identity:name:full is a permission bundle over first + last + the computed
// full name: a form with first/last inputs reads those directly (no lossy split),
// while a form wanting a single name reads full. All three ride in the payload.
const NMF_COMPOSITES = {
  'me:identity:name:full': [
    'me:identity:name:first',
    'me:identity:name:last',
    'me:identity:name:full',
  ],
};

// Values derived from atomic vault fields rather than stored directly.
function computeVaultValue(state, key) {
  if (key === 'me:identity:name:full') {
    return `${state['me:identity:name:first'] ?? ''} ${state['me:identity:name:last'] ?? ''}`.trim();
  }
  return state[key];
}

// Expand granted field keys into the concrete set of value keys to share.
function expandForShare(grantedKeys) {
  const out = [];
  for (const k of grantedKeys) {
    if (NMF_COMPOSITES[k]) out.push(...NMF_COMPOSITES[k]);
    else out.push(k);
  }
  return [...new Set(out)];
}

// Build the { key: value } map to encrypt & send, from granted keys + vault state.
// Phase 7 (app Approve handler) calls this to assemble the payload.
function buildSharePayload(grantedKeys, state) {
  const fields = {};
  for (const key of expandForShare(grantedKeys)) {
    fields[key] = computeVaultValue(state, key);
  }
  return fields;
}
