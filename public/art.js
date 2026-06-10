// art.js — original gothic/colonial role emblems, drawn as inline SVG.
// All artwork here is original work created for Salem Nights.
// Each emblem is a simple, evocative crest on a circular seal.

const PALETTE = {
  Town: '#c9a86a',     // candle gold
  Mafia: '#a23b2d',    // blood red
  Neutral: '#6e6e8a'   // grey violet
};

function seal(inner, team) {
  const c = PALETTE[team] || '#c9a86a';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="role-emblem">
    <defs>
      <radialGradient id="g-${team}" cx="50%" cy="38%" r="70%">
        <stop offset="0%" stop-color="#2a2230"/>
        <stop offset="100%" stop-color="#14101a"/>
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#g-${team})" stroke="${c}" stroke-width="2.5"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="0.8" opacity="0.5"/>
    <g stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${inner}
    </g>
  </svg>`;
}

const ICONS = {
  // TOWN
  Sheriff: seal(`<path d="M50 22 l22 9 v16 c0 16 -10 26 -22 31 c-12 -5 -22 -15 -22 -31 v-16 z"/>
    <path d="M50 40 l4 8 9 1 -6.5 6.5 1.5 9 -8 -4.5 -8 4.5 1.5 -9 -6.5 -6.5 9 -1 z" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Investigator: seal(`<circle cx="44" cy="44" r="16"/><line x1="56" y1="56" x2="74" y2="74"/>
    <path d="M38 44 a6 6 0 0 1 6 -6"/>`, 'Town'),
  Lookout: seal(`<path d="M22 50 q28 -26 56 0 q-28 26 -56 0 z"/><circle cx="50" cy="50" r="9" fill="${PALETTE.Town}" stroke="none"/>
    <circle cx="50" cy="50" r="3" fill="#14101a" stroke="none"/>`, 'Town'),
  Doctor: seal(`<rect x="42" y="26" width="16" height="48" rx="3" fill="${PALETTE.Town}" stroke="none"/>
    <rect x="26" y="42" width="48" height="16" rx="3" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Bodyguard: seal(`<path d="M50 22 l24 10 v14 c0 18 -12 28 -24 34 c-12 -6 -24 -16 -24 -34 v-14 z"/>
    <line x1="50" y1="34" x2="50" y2="64"/><line x1="38" y1="46" x2="62" y2="46"/>`, 'Town'),
  Jailor: seal(`<line x1="34" y1="26" x2="34" y2="74"/><line x1="46" y1="26" x2="46" y2="74"/>
    <line x1="58" y1="26" x2="58" y2="74"/><line x1="70" y1="26" x2="70" y2="74"/>
    <circle cx="52" cy="50" r="8" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Vigilante: seal(`<path d="M30 64 l30 -30 6 -10 -10 6 -30 30 z"/><circle cx="34" cy="62" r="4" fill="${PALETTE.Town}" stroke="none"/>
    <line x1="58" y1="40" x2="70" y2="52"/>`, 'Town'),
  Mayor: seal(`<path d="M28 64 v-22 l8 8 14 -22 14 22 8 -8 v22 z" fill="${PALETTE.Town}" stroke="none"/>
    <line x1="28" y1="70" x2="72" y2="70" stroke-width="4"/>`, 'Town'),
  Medium: seal(`<path d="M50 24 c14 0 24 12 24 28 c0 18 -16 24 -24 24 c-8 0 -24 -6 -24 -24 c0 -16 10 -28 24 -28 z" opacity="0.85"/>
    <circle cx="42" cy="48" r="3" fill="${PALETTE.Town}" stroke="none"/><circle cx="58" cy="48" r="3" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Escort: seal(`<path d="M34 74 q4 -22 16 -22 q12 0 16 22"/><circle cx="50" cy="38" r="10"/>
    <path d="M38 30 q12 -10 24 0" />`, 'Town'),
  Veteran: seal(`<path d="M28 70 l22 -44 22 44 z"/><line x1="40" y1="58" x2="60" y2="58"/>
    <circle cx="50" cy="40" r="3" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),

  // MAFIA
  Godfather: seal(`<path d="M30 44 q20 -16 40 0 l-4 6 h-32 z" fill="${PALETTE.Mafia}" stroke="none"/>
    <rect x="34" y="50" width="32" height="6" fill="${PALETTE.Mafia}" stroke="none"/>
    <path d="M30 44 q20 -16 40 0"/>`, 'Mafia'),
  Mafioso: seal(`<path d="M36 30 h28 l-4 14 h-20 z" fill="${PALETTE.Mafia}" stroke="none"/>
    <path d="M50 44 v24"/><path d="M42 56 h16"/><circle cx="50" cy="72" r="3" fill="${PALETTE.Mafia}" stroke="none"/>`, 'Mafia'),
  Framer: seal(`<rect x="30" y="30" width="40" height="40" rx="3"/><line x1="30" y1="42" x2="70" y2="42"/>
    <path d="M44 54 l6 6 12 -12" stroke="${PALETTE.Mafia}"/>`, 'Mafia'),
  Consigliere: seal(`<path d="M50 26 v48"/><path d="M34 38 h32"/><path d="M30 38 q-2 14 8 14"/>
    <path d="M70 38 q2 14 -8 14"/><circle cx="50" cy="74" r="3" fill="${PALETTE.Mafia}" stroke="none"/>`, 'Mafia'),

  // NEUTRAL
  SerialKiller: seal(`<path d="M40 28 l8 30"/><path d="M36 28 q10 -4 14 6"/><path d="M60 28 l-8 30"/>
    <path d="M64 28 q-10 -4 -14 6"/><circle cx="50" cy="64" r="6" fill="${PALETTE.Neutral}" stroke="none"/>`, 'Neutral'),
  Jester: seal(`<path d="M32 36 q18 -16 36 0 l-6 8 6 6 -10 4 2 10 -10 -4 -10 4 2 -10 -10 -4 6 -6 z"
    fill="${PALETTE.Neutral}" stroke="none"/><circle cx="34" cy="34" r="4" fill="${PALETTE.Neutral}" stroke="none"/>
    <circle cx="66" cy="34" r="4" fill="${PALETTE.Neutral}" stroke="none"/>`, 'Neutral'),
  Executioner: seal(`<path d="M34 26 h26 v6 h-10 v40 h-6 v-40 h-10 z" fill="${PALETTE.Neutral}" stroke="none"/>
    <path d="M50 36 a14 14 0 0 1 0 28" /><circle cx="50" cy="70" r="3" fill="${PALETTE.Neutral}" stroke="none"/>`, 'Neutral')
};

// A default crest for unknown / hidden roles
const HIDDEN = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="role-emblem">
  <circle cx="50" cy="50" r="48" fill="#14101a" stroke="#5a4a6a" stroke-width="2.5"/>
  <text x="50" y="66" font-size="44" text-anchor="middle" fill="#5a4a6a" font-family="Georgia">?</text>
</svg>`;

function emblemFor(roleKey) {
  return ICONS[roleKey] || HIDDEN;
}

// avatar token used in the player grid (smaller, faceless colonial silhouette)
function avatarToken(seedName, alive) {
  const hue = Math.abs(hashStr(seedName)) % 360;
  const fill = alive ? `hsl(${hue} 28% 42%)` : '#3a3340';
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" class="avatar-svg">
    <rect x="0" y="0" width="64" height="64" rx="8" fill="#1c1626"/>
    <circle cx="32" cy="24" r="12" fill="${fill}"/>
    <path d="M14 60 q0 -18 18 -18 q18 0 18 18 z" fill="${fill}"/>
    <path d="M20 18 q12 -12 24 0 l-2 4 q-10 -8 -20 0 z" fill="#0e0a14"/>
    ${alive ? '' : '<line x1="14" y1="14" x2="50" y2="50" stroke="#a23b2d" stroke-width="4"/><line x1="50" y1="14" x2="14" y2="50" stroke="#a23b2d" stroke-width="4"/>'}
  </svg>`;
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
