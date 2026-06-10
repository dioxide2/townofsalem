// roles.js — Classic-mode role definitions for Salem Nights.
// All descriptions are original. Mechanics derive from the public-domain
// Mafia/Werewolf party game lineage.

// Defense / attack levels
// 0 = None, 1 = Basic, 2 = Powerful, 3 = Unstoppable/Invincible
const LEVEL = { NONE: 0, BASIC: 1, POWERFUL: 2, UNSTOPPABLE: 3 };

// team: 'Town' | 'Mafia' | 'Neutral'
// actionType describes the night action the role may submit.
//   'kill', 'heal', 'protect', 'investigate', 'watch', 'roleblock',
//   'frame', 'jail', 'alert', 'none'
const ROLES = {
  // ---------------- TOWN ----------------
  Sheriff: {
    team: 'Town', category: 'Investigative', unique: false,
    actionType: 'investigate', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, interrogate one neighbor to learn whether they seem sinister.',
    detail: 'You learn if your target is a member of the Mafia or a Serial Killer ("Suspicious"), or otherwise "Not Suspicious". The Godfather and framed players can fool you.'
  },
  Investigator: {
    team: 'Town', category: 'Investigative', unique: false,
    actionType: 'investigate2', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, gather clues about one neighbor to narrow down their role.',
    detail: 'You receive a short list of roles your target could be. Framers can muddy your findings.'
  },
  Lookout: {
    team: 'Town', category: 'Investigative', unique: false,
    actionType: 'watch', target: 'any', defense: LEVEL.NONE,
    summary: 'Each night, stake out one house and see everyone who visits it.',
    detail: 'You learn the names of every player who visited your target that night.'
  },
  Doctor: {
    team: 'Town', category: 'Protective', unique: false,
    actionType: 'heal', target: 'any', defense: LEVEL.NONE,
    summary: 'Each night, tend to one neighbor, healing them from a single attack.',
    detail: 'Grants your target Basic defense for the night. You cannot heal yourself.'
  },
  Bodyguard: {
    team: 'Town', category: 'Protective', unique: false,
    actionType: 'protect', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, guard one neighbor. If attacked, you kill the attacker — and fall with them.',
    detail: 'If your target is attacked, you intercept: you slay one attacker and die in their place. Your target survives.'
  },
  Jailor: {
    team: 'Town', category: 'Killing', unique: true,
    actionType: 'jail', target: 'other', defense: LEVEL.NONE, dayAction: true,
    summary: 'By day, drag one suspect to jail. By night, decide whether to execute them.',
    detail: 'A jailed player cannot act and cannot be visited. You may execute them once you have an execution available. Executing a Town member costs you your remaining executions.'
  },
  Vigilante: {
    team: 'Town', category: 'Killing', unique: false,
    actionType: 'kill', target: 'other', defense: LEVEL.NONE, attack: LEVEL.BASIC, bullets: 3,
    summary: 'Each night, you may take justice into your own hands and shoot a suspect.',
    detail: 'You have a limited number of bullets. If you gun down a fellow Townsperson, guilt will claim you the following night.'
  },
  Mayor: {
    team: 'Town', category: 'Support', unique: true,
    actionType: 'reveal', target: 'self', defense: LEVEL.NONE, dayAction: true,
    summary: 'Reveal yourself as Mayor to make your vote count for three.',
    detail: 'Once revealed, your votes count triple — but you can no longer be healed by a Doctor.'
  },
  Medium: {
    team: 'Town', category: 'Support', unique: false,
    actionType: 'none', target: 'none', defense: LEVEL.NONE,
    summary: 'Commune with the dead — speak privately with fallen players each night.',
    detail: 'At night you join the graveyard chat with the dead.'
  },
  Escort: {
    team: 'Town', category: 'Support', unique: false,
    actionType: 'roleblock', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, distract one neighbor, keeping them home and unable to act.',
    detail: 'Your target performs no night action. A Serial Killer you block will kill you instead.'
  },
  Veteran: {
    team: 'Town', category: 'Killing', unique: true,
    actionType: 'alert', target: 'self', defense: LEVEL.NONE, attack: LEVEL.POWERFUL, alerts: 3,
    summary: 'You may go on alert. Anyone who visits you that night meets a swift end.',
    detail: 'While on alert you gain Basic defense and kill every visitor. You have a limited number of alerts.'
  },

  // ---------------- MAFIA ----------------
  Godfather: {
    team: 'Mafia', category: 'Killing', unique: true,
    actionType: 'mafiakill', target: 'other', defense: LEVEL.BASIC, attack: LEVEL.BASIC,
    summary: 'You lead the Mafia. Order the night kill — and appear innocent to investigators.',
    detail: 'You appear Not Suspicious to the Sheriff. If a Mafioso lives, they carry out your order; otherwise you do it yourself.'
  },
  Mafioso: {
    team: 'Mafia', category: 'Killing', unique: true,
    actionType: 'mafiakill', target: 'other', defense: LEVEL.NONE, attack: LEVEL.BASIC,
    summary: 'You carry out the Godfather’s orders, striking down the Mafia’s target.',
    detail: 'You perform the Mafia’s nightly kill. If the Godfather dies, you are promoted to take their place.'
  },
  Framer: {
    team: 'Mafia', category: 'Deception', unique: false,
    actionType: 'frame', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, frame a neighbor so investigators see them as a criminal.',
    detail: 'Your target appears Suspicious to the Sheriff and as a Mafia role to the Investigator on the following day.'
  },
  Consigliere: {
    team: 'Mafia', category: 'Support', unique: false,
    actionType: 'investigate', target: 'other', defense: LEVEL.NONE,
    summary: 'Each night, study a neighbor to discover their exact role.',
    detail: 'You learn your target’s precise role.'
  },

  // ---------------- NEUTRAL ----------------
  SerialKiller: {
    team: 'Neutral', category: 'Killing', unique: false,
    actionType: 'kill', target: 'other', defense: LEVEL.BASIC, attack: LEVEL.BASIC,
    summary: 'A lone murderer. Kill each night and be the last soul standing.',
    detail: 'You are immune to roleblocking — anyone who tries to block you dies. You win when all who would oppose you are gone.'
  },
  Jester: {
    team: 'Neutral', category: 'Chaos', unique: false,
    actionType: 'none', target: 'none', defense: LEVEL.NONE,
    summary: 'You crave the noose. Trick the Town into lynching you to win.',
    detail: 'If you are executed by vote, you win. That night you may haunt one of those who voted guilty, and they will die.'
  },
  Executioner: {
    team: 'Neutral', category: 'Chaos', unique: false,
    actionType: 'none', target: 'none', defense: LEVEL.BASIC,
    summary: 'You have a personal vendetta. Get your target lynched to win.',
    detail: 'You are assigned a Town target at the start. You win if they are executed by vote. If they die another way, you become a Jester.'
  }
};

module.exports = { ROLES, LEVEL };
