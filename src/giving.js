'use strict';
const { all } = require('./db');

// The parts of the Giving page. Photos are assigned to a part in the admin (media.giving).
const GIVING = [
  { key: 'food', icon: 'food', title: 'Food for the home', short: 'Flour, greens and essentials to take home', cta: 'Give food',
    text: 'Flour, fresh greens and other essentials are placed in our elders\' hands at our gatherings, to carry home.' },
  { key: 'warmth', icon: 'heart', title: 'Blankets and warm clothing', short: 'Comfort through Limuru\'s cold season', cta: 'Give warmth',
    text: 'Limuru is cold. Blankets and warm clothing help our elders stay comfortable and well.' },
  { key: 'meals', icon: 'users', title: 'Meals shared together', short: 'A plate served, and company to share it', cta: 'Give a meal',
    text: 'At our gatherings elders are served and share food together, with friends beside them.' },
  { key: 'care', icon: 'hands', title: 'A helping hand', short: 'Help to walk, a warm greeting, an embrace', cta: 'Support an elder',
    text: 'Helping hands steady our elders on the steps, greet them and stay close. No one should grow old alone.' },
];
const KEYS = GIVING.map((g) => g.key);

/** Parts that have at least one photo, newest gathering first. */
async function givingGroups() {
  const rows = await all(`SELECT m.*, e.title AS event_title FROM media m LEFT JOIN events e ON e.id=m.event_id
    WHERE m.giving<>'' AND m.kind='image' ORDER BY COALESCE(e.start_date,'2000-01-01') DESC, m.sort, m.id`);
  return GIVING.map((g) => ({ ...g, photos: rows.filter((m) => m.giving === g.key) })).filter((g) => g.photos.length);
}
module.exports = { GIVING, KEYS, givingGroups };
