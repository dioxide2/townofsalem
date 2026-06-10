// roles.js — final role set for Salem Nights.
// All descriptions are original. Mechanics derive from the public-domain
// Mafia/Werewolf party game lineage.

// Defense / attack levels
// 0 = None, 1 = Basic, 2 = Powerful, 3 = Unstoppable/Invincible
const LEVEL = { NONE: 0, BASIC: 1, POWERFUL: 2, UNSTOPPABLE: 3 };

// team: 'Town' | 'Mafia' | 'Neutral'
// actionType: 'mafiakill' | 'heal' | 'investigate' | 'kill' | 'jail' | 'none'
const ROLES = {
  // ---------------- TOWN ----------------
  Villager: {
    team: 'Town', category: 'Common', unique: false,
    actionType: 'none', target: 'none', defense: LEVEL.NONE,
    summary: 'An ordinary townsfolk. You have no night action — your power is your voice and your vote.',
    detail: 'By day, share what you know, root out the Mafia, and help send the guilty to the gallows.'
  },
  Jailor: {
    team: 'Town', category: 'Killing', unique: true,
    actionType: 'jail', target: 'other', defense: LEVEL.NONE, dayAction: true,
    summary: 'By day, drag one suspect to jail. By night, decide whether to execute them.',
    detail: 'A jailed player cannot act and cannot be visited. You may speak privately with your prisoner, and you may execute them. Executing a fellow Townsperson ends your ability to execute.'
  },
  Investigator: {
    team: 'Town', category: 'Investigative', unique: false,
    actionType: 'investigate', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, investigate one neighbor to learn whether they consort with the Mafia.',
    detail: 'You learn if your target appears to be working with the Mafia. The Godfather is cunning and will appear innocent.'
  },
  Doctor: {
    team: 'Town', category: 'Protective', unique: false,
    actionType: 'heal', target: 'any', defense: LEVEL.NONE,
    summary: 'Each night, tend to one neighbor, healing them from a single attack.',
    detail: 'Grants your target enough protection to survive one attack for the night. You cannot heal yourself.'
  },
  Vigilante: {
    team: 'Town', category: 'Killing', unique: false,
    actionType: 'kill', target: 'other', defense: LEVEL.NONE, attack: LEVEL.BASIC, bullets: 2,
    summary: 'A villager with a gun. Each night you may shoot one suspect — but you have only two bullets.',
    detail: 'Use your two shots wisely. Be sure of your aim: there is no taking a bullet back.'
  },

  // ---------------- MAFIA ----------------
  Godfather: {
    team: 'Mafia', category: 'Killing', unique: true,
    actionType: 'mafiakill', target: 'other', defense: LEVEL.NONE, attack: LEVEL.BASIC,
    summary: 'You lead the Mafia. Order the night kill — and appear innocent to investigators.',
    detail: 'You appear innocent to the Investigator. If a Mafioso lives, they carry out your order; otherwise you strike yourself.'
  },
  Mafioso: {
    team: 'Mafia', category: 'Killing', unique: false,
    actionType: 'mafiakill', target: 'other', defense: LEVEL.NONE, attack: LEVEL.BASIC,
    summary: 'You serve the Mafia, striking down its chosen target under cover of night.',
    detail: 'Your faction makes one kill each night. If the Godfather falls, a Mafioso is promoted to take their place.'
  },

  // ---------------- NEUTRAL ----------------
  Jester: {
    team: 'Neutral', category: 'Chaos', unique: false,
    actionType: 'none', target: 'none', defense: LEVEL.NONE,
    summary: 'You crave the noose. Trick the Town into executing you to win.',
    detail: 'If the Town votes to execute you, you win. That night you may haunt one of those who voted guilty, and they will die.'
  }
};

module.exports = { ROLES, LEVEL };
