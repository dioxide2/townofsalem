// art.js — original gothic/colonial artwork for Salem Nights.
// All artwork here is original work: SVG role emblems, village houses,
// villager figures, and gravestones. No third-party assets are used.

const PALETTE = { Town: '#c9a86a', Mafia: '#a23b2d', Neutral: '#6e6e8a' };

function seal(inner, team) {
  const c = PALETTE[team] || '#c9a86a';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="role-emblem">
    <defs><radialGradient id="g-${team}" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#2a2230"/><stop offset="100%" stop-color="#14101a"/>
    </radialGradient></defs>
    <circle cx="50" cy="50" r="48" fill="url(#g-${team})" stroke="${c}" stroke-width="2.5"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="0.8" opacity="0.5"/>
    <g stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
  </svg>`;
}

const ICONS = {
  Villager: seal(`<circle cx="50" cy="40" r="11"/><path d="M30 74 q0 -20 20 -20 q20 0 20 20"/>`, 'Town'),
  Jailor: seal(`<line x1="34" y1="26" x2="34" y2="74"/><line x1="46" y1="26" x2="46" y2="74"/>
    <line x1="58" y1="26" x2="58" y2="74"/><line x1="70" y1="26" x2="70" y2="74"/>
    <circle cx="52" cy="50" r="8" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Investigator: seal(`<circle cx="44" cy="44" r="16"/><line x1="56" y1="56" x2="74" y2="74"/>
    <path d="M38 44 a6 6 0 0 1 6 -6"/>`, 'Town'),
  Doctor: seal(`<rect x="42" y="26" width="16" height="48" rx="3" fill="${PALETTE.Town}" stroke="none"/>
    <rect x="26" y="42" width="48" height="16" rx="3" fill="${PALETTE.Town}" stroke="none"/>`, 'Town'),
  Vigilante: seal(`<path d="M30 64 l30 -30 6 -10 -10 6 -30 30 z"/><circle cx="34" cy="62" r="4" fill="${PALETTE.Town}" stroke="none"/>
    <line x1="58" y1="40" x2="70" y2="52"/>`, 'Town'),
  Godfather: seal(`<path d="M30 44 q20 -16 40 0 l-4 6 h-32 z" fill="${PALETTE.Mafia}" stroke="none"/>
    <rect x="34" y="50" width="32" height="6" fill="${PALETTE.Mafia}" stroke="none"/>
    <path d="M30 44 q20 -16 40 0"/>`, 'Mafia'),
  Mafioso: seal(`<path d="M36 30 h28 l-4 14 h-20 z" fill="${PALETTE.Mafia}" stroke="none"/>
    <path d="M50 44 v24"/><path d="M42 56 h16"/><circle cx="50" cy="72" r="3" fill="${PALETTE.Mafia}" stroke="none"/>`, 'Mafia'),
  Jester: seal(`<path d="M32 36 q18 -16 36 0 l-6 8 6 6 -10 4 2 10 -10 -4 -10 4 2 -10 -10 -4 6 -6 z"
    fill="${PALETTE.Neutral}" stroke="none"/><circle cx="34" cy="34" r="4" fill="${PALETTE.Neutral}" stroke="none"/>
    <circle cx="66" cy="34" r="4" fill="${PALETTE.Neutral}" stroke="none"/>`, 'Neutral')
};

const HIDDEN = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="role-emblem">
  <circle cx="50" cy="50" r="48" fill="#14101a" stroke="#5a4a6a" stroke-width="2.5"/>
  <text x="50" y="66" font-size="44" text-anchor="middle" fill="#5a4a6a" font-family="Georgia">?</text></svg>`;

function emblemFor(roleKey) { return ICONS[roleKey] || HIDDEN; }

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function houseSVG(seedName) {
  const h = Math.abs(hashStr(seedName));
  const roofs = ['#5b3a2e', '#4a3326', '#6b4636', '#3f2d24', '#574033'];
  const walls = ['#7a6a52', '#857354', '#6f5f49', '#8a7a5e', '#736449'];
  const roof = roofs[h % roofs.length];
  const wall = walls[(h >> 3) % walls.length];
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="house-svg">
    <rect x="80" y="26" width="12" height="22" fill="${roof}"/>
    <path d="M16 56 L60 24 L104 56 Z" fill="${roof}"/>
    <path d="M16 56 L60 24 L104 56 Z" fill="none" stroke="#2a1f18" stroke-width="2"/>
    <rect x="26" y="56" width="68" height="50" fill="${wall}" stroke="#2a1f18" stroke-width="2"/>
    <rect x="52" y="78" width="16" height="28" rx="1" fill="#3a2a1e" stroke="#211710" stroke-width="1.5"/>
    <circle cx="64" cy="92" r="1.6" fill="#d8b25a"/>
    <rect class="window" x="34" y="66" width="14" height="14" fill="#2a2a32" stroke="#211710" stroke-width="1.5"/>
    <rect class="window" x="72" y="66" width="14" height="14" fill="#2a2a32" stroke="#211710" stroke-width="1.5"/>
    <line x1="41" y1="66" x2="41" y2="80" stroke="#211710" stroke-width="1"/>
    <line x1="79" y1="66" x2="79" y2="80" stroke="#211710" stroke-width="1"/>
  </svg>`;
}

function figureSVG(seedName, opts = {}) {
  const hue = Math.abs(hashStr(seedName)) % 360;
  const coat = `hsl(${hue} 30% ${opts.dim ? 26 : 40}%)`;
  const coatDark = `hsl(${hue} 32% ${opts.dim ? 18 : 28}%)`;
  const skin = '#caa882';
  return `<svg viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg" class="figure-svg">
    <ellipse cx="24" cy="15" rx="15" ry="4" fill="${coatDark}"/>
    <rect x="17" y="3" width="14" height="11" rx="2" fill="${coatDark}"/>
    <circle cx="24" cy="20" r="8" fill="${skin}"/>
    <path d="M10 66 q0 -28 14 -28 q14 0 14 28 z" fill="${coat}"/>
    <path d="M18 40 l6 6 6 -6" fill="none" stroke="${coatDark}" stroke-width="2"/>
    <path d="M12 48 q-3 8 -1 16" stroke="${coatDark}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M36 48 q3 8 1 16" stroke="${coatDark}" stroke-width="4" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function tombstoneSVG() {
  return `<svg viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg" class="tomb-svg">
    <path d="M12 70 V36 a12 12 0 0 1 24 0 V70 Z" fill="#6a6a72" stroke="#3a3a42" stroke-width="2"/>
    <path d="M24 44 v12 M18 50 h12" stroke="#3a3a42" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse cx="24" cy="70" rx="16" ry="3" fill="#1c1626"/>
  </svg>`;
}

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

// central gallows / scaffold for the town square (original art)
function gallowsSVG() {
  return `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" class="gallows-svg">
    <ellipse cx="50" cy="113" rx="32" ry="7" fill="rgba(0,0,0,0.35)"/>
    <rect x="45" y="18" width="11" height="95" fill="#5a3f2a" stroke="#2e2013" stroke-width="2"/>
    <rect x="22" y="18" width="40" height="10" fill="#6b4a30" stroke="#2e2013" stroke-width="2"/>
    <path d="M45 32 L31 19" stroke="#4a3320" stroke-width="4" stroke-linecap="round"/>
    <line x1="30" y1="28" x2="30" y2="48" stroke="#cbb68a" stroke-width="2"/>
    <circle cx="30" cy="54" r="6" fill="none" stroke="#cbb68a" stroke-width="2.4"/>
  </svg>`;
}
