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
  Medium: {
    team: 'Town', category: 'Support', unique: true,
    actionType: 'none', target: 'none', defense: LEVEL.NONE,
    summary: 'Each night you hold a séance, speaking privately with the dead.',
    detail: 'While you live, you may converse with all fallen players in the graveyard each night.'
  },
  Lookout: {
    team: 'Town', category: 'Investigative', unique: true,
    actionType: 'watch', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, watch one house and see everyone who visits it.',
    detail: 'You learn the names of every player who visited your target that night.'
  },
  Tracker: {
    team: 'Town', category: 'Investigative', unique: true,
    actionType: 'track', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, follow one neighbor and see whom they visit.',
    detail: 'You learn who your target visited that night, if anyone.'
  },
  Veteran: {
    team: 'Town', category: 'Killing', unique: true,
    actionType: 'alert', target: 'self', defense: LEVEL.NONE, attack: LEVEL.POWERFUL, alerts: 2,
    summary: 'You may go on alert up to twice. On alert, you slay anyone who visits you.',
    detail: 'While on alert you gain protection and kill every visitor. You have two alerts for the whole game.'
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
  Consigliere: {
    team: 'Mafia', category: 'Support', unique: true,
    actionType: 'investigateExact', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, investigate one neighbor to uncover their exact role.',
    detail: 'You learn precisely what role your target holds. You do not perform the Mafia\'s kill, but you will be promoted to lead if the killers fall.'
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
