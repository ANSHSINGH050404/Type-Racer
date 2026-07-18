/** English passages ~150–250 characters. Random pick at race start (server-side). */
export const PASSAGES: string[] = [
  "The quick brown fox jumps over the lazy dog near the riverbank while birds circle above the tall pines and the wind carries the scent of rain across the open field.",
  "Typing is a race against yourself as much as anyone else. Keep your eyes on the next word, trust your fingers, and let rhythm replace panic when the clock starts ticking.",
  "In a quiet cafe, two friends argued about whether coffee tastes better before noon. They never settled it, but they did invent a better way to share a single table charger.",
  "Code is written once and read a hundred times. Prefer clear names, small functions, and comments that explain why you chose the strange path, not what the code already says.",
  "Thunder rolled across the valley as hikers scrambled for the trailhead. Someone laughed too loudly, someone checked the map twice, and everyone pretended not to be soaked.",
  "A good race feels short even when it is long. You notice mistakes only after you fix them, and the finish line appears just when your hands start to feel warm and sure.",
  "Libraries smell like paper and dust and distant summers. You open a book at random and find a sentence that feels written for the exact afternoon you are living through.",
  "She practiced piano every morning before the city woke up. Scales first, then a piece she half-remembered, until the keys felt like a language she could speak without thinking.",
  "Trains arrive late more often than people admit. Still, platforms fill with hope, coffee cups, and half-finished messages, as if punctuality were optional and stories were not.",
  "Build tools that disappear into the work. When someone races a friend and forgets the software exists, you have done the quiet kind of design that rarely gets a trophy.",
  "Ocean waves keep no calendar. They erase footprints and rearrange shells, then return with the same patient roar that convinced ancient sailors the world was bigger than maps.",
  "Keyboard shortcuts feel like magic until muscle memory takes over. Suddenly you are flying through edits, and the mouse becomes a stranger sitting unused beside the pad.",
  "Friendship survives distance when you invent small rituals. A shared link, a silly score, a rematch button. Tiny arenas where pride is soft and laughing is allowed to win.",
  "Night markets glow with steam and neon and voices stacking over each other. You buy something fried, burn your tongue, and swear it was worth every impatient second of waiting.",
  "Precision matters more than speed until speed becomes precision. Type carefully first. The numbers rise on their own when fear leaves your shoulders and the text starts to flow.",
  "Maps are promises drawn by people who once got lost. Follow them anyway, but keep enough curiosity to notice when the path wants to become a meadow instead of a road.",
  "Winter mornings teach patience. The kettle takes forever, the window fogs, and your thoughts move slower than usual, which is sometimes exactly the pace the day needs.",
  "A single well-chosen word can change the temperature of a room. Choose kindly when you can, clearly when you must, and briefly when the other person is already halfway gone.",
  "Stars look still only because we are impatient. Give them a long enough night and they wheel across the sky like a quiet machine that never bothers to explain itself.",
  "Practice does not make perfect. Practice makes permanent. So practice the version of yourself you would be proud to meet at the finish line, even when nobody is watching.",
  "The best trash talk is light enough to float and sharp enough to land. Say it, race hard, then mean the handshake. Rivalry without malice is one of the finer human sports.",
  "Clouds stack like unfinished paragraphs above the highway. Drivers invent destinations in their heads while the radio fills the silence that rain would have filled better.",
  "Learning a new skill is mostly recovering from looking foolish. The hands remember long after the ego stops complaining, which is why beginners should protect their joy carefully.",
  "Some doors open only when you stop pushing. Stand back, breathe, try the handle again with less drama. Many problems are not locked; they are simply badly introduced.",
  "Streetlights flicker in sequence as if the city were winking. You walk faster without deciding to, chasing a rhythm that belongs to asphalt, shoes, and unfinished thoughts.",
  "Curiosity is a renewable resource if you refuse to pretend you already know. Ask the second question. Then the third. The interesting part of most stories lives past the summary.",
  "Rain on a metal roof is a kind of applause for staying indoors. Make tea, open a notebook, and write the sentence you have been avoiding since last Tuesday afternoon.",
  "Victory is thin if nobody you like was racing. Find a worthy opponent, share the track, and let the scoreboard be a souvenir rather than a verdict on your entire week.",
  "Ideas arrive sideways. You will be washing a mug or tying a shoe when the missing piece appears, uninvited and perfect, as if it had been waiting for you to look away.",
  "Keep your posture honest and your shoulders loose. Tension steals accuracy long before it steals speed. Breathe on the punctuation marks and trust the next word to appear.",
];

export function pickPassage(exclude?: string | null): string {
  if (PASSAGES.length === 0) {
    return "Type this sentence to finish the race.";
  }
  if (!exclude || PASSAGES.length === 1) {
    return PASSAGES[Math.floor(Math.random() * PASSAGES.length)]!;
  }
  let next = exclude;
  let guard = 0;
  while (next === exclude && guard < 20) {
    next = PASSAGES[Math.floor(Math.random() * PASSAGES.length)]!;
    guard += 1;
  }
  return next;
}
