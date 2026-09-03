/* ── SPLIT STACK · avatars ─────────────────────────────────────────────────
   Objects, not faces. A tapir, a car, a bar of soap — the register is the
   same one the settings work in: ordinary things lit like they matter.

   Their palette is fixed rather than taken from the scene. An avatar is who
   you are, not where you are playing, so it must not change colour when
   somebody switches the table under it.

   Each sprite is a grid of characters, one per pixel, keyed by AV. A dot is
   transparent. Twenty by sixteen, drawn to be read at that size and no
   larger — these sit at 20-30 pixels on a card, not on a poster.
   ──────────────────────────────────────────────────────────────────────── */

var AV = {
  K: '#241c2e',   // outline, a purple-black rather than a true black
  W: '#f4ecd8',   // card cream, for highlights and whites
  G: '#b9aec4',   // cool grey
  D: '#5a4f6b',   // deep grey-violet
  P: '#ff6ea8',   // hot pink
  M: '#c93f78',   // deep pink, for the shaded side of a pink thing
  C: '#67d9e8',   // cyan
  B: '#3f7fc4',   // blue
  V: '#8f6fd0',   // violet
  O: '#ff9a3c',   // ember orange
  Y: '#ffd76e',   // gold
  R: '#e0453f',   // red
  T: '#3fbfa0',   // teal
  S: '#c98a52',   // cigar wrapper, lit side
  N: '#7d4a2c'    // cigar wrapper, shaded side
};

var AVATARS = [
  {
    name: 'FISH',
    /* The default nobody chose, so it wants to be the friendliest of the set.
       Round body, forked tail, one eye well forward. */
    art: [
      '....................',
      '.........KKK........',
      '........KOOOK.......',
      '......KKOOOOOKK.....',
      '....KKOOOOOOOOOKK.KK',
      '..KKOOOOOOOOOOOOOKOK',
      '.KOWOOOOOOOOOOOOOOOK',
      '.KOOOOOOOOOOOOOOOOOK',
      '.KKOOOOOOOOOOOOOOKOK',
      '...KKOOOOOOOOOOKK.KK',
      '.....KKOOOOOOKK.....',
      '.......KKOOKK.......',
      '.........KK.........',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'TANK',
    /* Barrel, turret, tracks. The long gun reaching past the hull is the
       one line that says tank rather than truck. */
    art: [
      '....................',
      '....................',
      '........KKKKK.......',
      '.......KTTTTTK......',
      '......KTTTTTTTKKKKKK',
      '......KTTTTTTTKKKKKK',
      '...KKKKKKKKKKKK.....',
      '..KTTTTTTTTTTTTK....',
      '..KTTTTTTTTTTTTK....',
      '.KKKKKKKKKKKKKKKK...',
      '.KDGDDGDDGDDGDDGK...',
      '.KDGDDGDDGDDGDDGK...',
      '.KKKKKKKKKKKKKKKK...',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'SOAP',
    art: [
      '....................',
      '....................',
      '.....KKKKKKKKKK.....',
      '...KKPPPPPPPPPPKK...',
      '..KPWWPPPPPPPPPPPK..',
      '..KPWPPPPPPPPPPPPK..',
      '..KPPPPPPPPPPPPPPK..',
      '..KPPPPPPPPPPPPPPK..',
      '..KMPPPPPPPPPPPPMK..',
      '..KMMPPPPPPPPPPMMK..',
      '...KKMMMMMMMMMMKK...',
      '.....KKKKKKKKKK.....',
      '....................',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'CAP',
    art: [
      '....................',
      '....................',
      '.........KKKK.......',
      '.......KKCCCCKK.....',
      '......KCCCCCCCCK....',
      '.....KCCWCCCCCCCK...',
      '....KCCCCCCCCCCCK...',
      '....KCCCCCCCCCCCK...',
      'KKKKKKKKKKKKKKKKK...',
      'KBBBBBBKKKKKKKKK....',
      '.KKKKKKK............',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'CIGAR',
    /* Fatter than a cigarette and tapered at the tail, which is the whole
       difference at this size — plus the band, which nothing else has. */
    art: [
      '....................',
      '..............G.....',
      '.............G......',
      '..............G.....',
      '....................',
      '.....KKKKKKKKKKKK...',
      '...KKSSSSYSSSSGGOK..',
      '..KSSSSSSYSSSSGOOK..',
      '..KNNNNNNYNNNNGOOK..',
      '...KKNNNNYNNNNGGOK..',
      '.....KKKKKKKKKKKK...',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'DICE',
    art: [
      '.........K..........',
      '........K.K.........',
      '.......K...K........',
      '......K.....K.......',
      '..KKKKKKK.KKKKKKK...',
      '..KPPPPPK.KPPPPPK...',
      '..KPWPWPK.KPPWPPK...',
      '..KPPPPPK.KPPPPPK...',
      '..KPWPWPK.KPWPWPK...',
      '..KPPPPPK.KPPPPPK...',
      '..KMMMMMK.KMMMMMK...',
      '..KKKKKKK.KKKKKKK...',
      '....................',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'MUG',
    /* Handle on the right and a dark surface at the top — without the coffee
       showing it is just a cylinder. */
    art: [
      '....................',
      '.........G..........',
      '........G...........',
      '....................',
      '....KKKKKKKKKK......',
      '....KNNNNNNNNKKKK...',
      '....KWWWWWWWWK..KK..',
      '....KWWWWWWWWK...K..',
      '....KWWWWWWWWK...K..',
      '....KWWWWWWWWK..KK..',
      '....KWWWWWWWWKKKK...',
      '....KWWWWWWWWK......',
      '....KKKKKKKKKK......',
      '....................',
      '....................',
      '....................'
    ]
  },
  {
    name: 'RING',
    /* Seen face on, so the band reads as a ring rather than as a bracelet,
       with the stone breaking the circle at the top. */
    art: [
      '....................',
      '.........KK.........',
      '........KCCK........',
      '.......KCWCCK.......',
      '.......KCCCCK.......',
      '......KKYYYYKK......',
      '.....KYYKKKKYYK.....',
      '....KYYK....KYYK....',
      '....KYK......KYK....',
      '....KYK......KYK....',
      '....KYYK....KYYK....',
      '.....KYYKKKKYYK.....',
      '......KKYYYYKK......',
      '........KKKK........',
      '....................',
      '....................'
    ]
  }
];

/* Draw one, centred in a box. The caller decides whether it sits on card
   stock or bare — the sprite carries no ground of its own.

   `k` is a whole-number magnification. A 20x16 sprite lost in a 46-pixel
   tile reads as a stamp on a lot of empty card; drawn at two it fills the
   space it was given. Whole numbers only, because this is pixel art and a
   fractional enlargement smears every edge it has. */
function drawAvatarArt(fb, x, y, w, h, idx, k) {
  var n = AVATARS.length;
  var art = AVATARS[((idx % n) + n) % n].art;
  k = Math.max(1, k | 0) || 1;
  var aw = art[0].length * k, ah = art.length * k;
  var ox = x + ((w - aw) >> 1), oy = y + ((h - ah) >> 1);
  for (var j = 0; j < art.length; j++) {
    var row = art[j];
    for (var i = 0; i < row.length; i++) {
      var c = row[i];
      if (c !== '.') fb.rect(ox + i * k, oy + j * k, k, k, AV[c] ? hex(AV[c]) : null);
    }
  }
}

function avatarName(idx) {
  var n = AVATARS.length;
  return AVATARS[((idx % n) + n) % n].name;
}
function avatarCount() { return AVATARS.length; }
