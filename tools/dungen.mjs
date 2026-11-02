// Lays out cathedral levels that the game's own generator cannot make, in the
// ASCII format of tools/dunmaker.mjs, which then turns them into .dun files.
//
//   node tools/dungen.mjs maze  <seed> <out.txt>
//   node tools/dungen.mjs rooms <seed> <out.txt>
//
// maze:  a labyrinth of one-tile corridors around a pillared chamber, with
//        monsters and chests in its dead ends.
// rooms: themed rooms of monsters joined by corridors, doors where the
//        corridors come in, and a boss room as far from the start as it gets.
//
// Every map starts on tile 12,12, the default --dun-pos, and uses only
// monsters the shareware data has.
import { writeFileSync } from 'node:fs';

const [kind, seedArg, outPath] = process.argv.slice(2);
if (!['maze', 'rooms'].includes(kind) || !/^\d+$/.test(seedArg ?? '') || !outPath) {
  console.error('usage: node tools/dungen.mjs <maze|rooms> <seed> <out.txt>');
  process.exit(2);
}
const seed = Number(seedArg);

// mulberry32
let rngState = seed >>> 0;
function random() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd = (n) => Math.floor(random() * n);
const pick = (xs) => xs[rnd(xs.length)];
const shuffle = (xs) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

function heap(less) {
  const a = [];
  return {
    size: () => a.length,
    push(v) {
      a.push(v);
      for (let i = a.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (less(a[i], a[p]) >= 0) break;
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      }
    },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && less(a[l], a[m]) < 0) m = l;
          if (r < a.length && less(a[r], a[m]) < 0) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top;
    },
  };
}

const START = { x: 12, y: 12 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeGrid(w, h) {
  const cells = Array.from({ length: h }, () => new Array(w).fill('#'));
  const g = {
    w, h, cells,
    get: (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? cells[y][x] : '#'),
    set: (x, y, ch) => { cells[y][x] = ch; },
    isOpen: (x, y) => g.get(x, y) !== '#' && g.get(x, y) !== 'D' && g.get(x, y) !== 'P',
    text: () => cells.map((r) => r.join('')).join('\n') + '\n',
  };
  return g;
}

// Steps from the start over walkable tiles (doors count as walkable).
function distances(g) {
  const dist = new Map();
  const key = (x, y) => y * g.w + x;
  const queue = [[START.x, START.y]];
  dist.set(key(START.x, START.y), 0);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const ch = g.get(nx, ny);
      if (ch === '#' || ch === 'P' || dist.has(key(nx, ny))) continue;
      dist.set(key(nx, ny), dist.get(key(x, y)) + 1);
      queue.push([nx, ny]);
    }
  }
  return { at: (x, y) => dist.get(key(x, y)), count: dist.size };
}

// ---- labyrinth --------------------------------------------------------------
function maze() {
  const n = 18;                       // cells per side, cell k on tile 2 + 2k
  const g = makeGrid(2 * n + 3, 2 * n + 3);
  const tile = (k) => 2 + 2 * k;
  const chamber = { k0: 7, k1: 10 };  // cells 7..10, tiles 16..22
  const inChamber = (i, j) => i >= chamber.k0 && i <= chamber.k1 && j >= chamber.k0 && j <= chamber.k1;

  const visited = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => inChamber(i, j)));
  const startCell = { i: (START.x - 2) / 2, j: (START.y - 2) / 2 };
  const stack = [startCell];
  visited[startCell.i][startCell.j] = true;
  g.set(tile(startCell.i), tile(startCell.j), '.');
  while (stack.length) {
    const { i, j } = stack[stack.length - 1];
    const next = shuffle(DIRS.map(([di, dj]) => ({ i: i + di, j: j + dj })))
      .find((c) => c.i >= 0 && c.j >= 0 && c.i < n && c.j < n && !visited[c.i][c.j]);
    if (!next) { stack.pop(); continue; }
    visited[next.i][next.j] = true;
    g.set(tile(next.i), tile(next.j), '.');
    g.set((tile(i) + tile(next.i)) / 2, (tile(j) + tile(next.j)) / 2, '.');
    stack.push(next);
  }

  // A few loops, so that not every wrong turn is a dead end.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const ni = i + di, nj = j + dj;
        if (ni >= n || nj >= n || inChamber(i, j) || inChamber(ni, nj)) continue;
        const wx = (tile(i) + tile(ni)) / 2, wy = (tile(j) + tile(nj)) / 2;
        if (g.get(wx, wy) === '#' && random() < 0.07) g.set(wx, wy, '.');
      }

  // The chamber, opened on two opposite sides.
  const c0 = tile(chamber.k0), c1 = tile(chamber.k1);
  for (let y = c0; y <= c1; y++)
    for (let x = c0; x <= c1; x++) g.set(x, y, '.');
  const k = chamber.k0 + rnd(chamber.k1 - chamber.k0 + 1);
  if (random() < 0.5) {
    g.set(c0 - 1, tile(k), '.');
    g.set(c1 + 1, tile(chamber.k0 + chamber.k1 - k), '.');
  } else {
    g.set(tile(k), c0 - 1, '.');
    g.set(tile(chamber.k0 + chamber.k1 - k), c1 + 1, '.');
  }
  const mid = (c0 + c1) / 2;
  for (const [x, y] of [[c0 + 1, c0 + 1], [c1 - 1, c0 + 1], [c0 + 1, c1 - 1], [c1 - 1, c1 - 1]]) g.set(x, y, 'P');
  g.set(mid, mid, 'c');
  for (const [x, y] of [[mid - 1, mid - 2], [mid + 1, mid + 2], [mid - 2, mid + 1], [mid + 2, mid - 1]]) g.set(x, y, 'a');
  g.set(mid, c0, 'L');
  for (const [x, y] of [[c0, mid], [c1, mid]]) g.set(x, y, 'K');

  // Dead ends get a chest or a guard; corridors get the odd wanderer.
  const dist = distances(g);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (inChamber(i, j)) continue;
      const x = tile(i), y = tile(j);
      if (g.get(x, y) !== '.' || (dist.at(x, y) ?? 0) < 6) continue;
      const exits = DIRS.filter(([dx, dy]) => g.isOpen(x + dx, y + dy)).length;
      if (exits === 1) g.set(x, y, random() < 0.45 ? pick(['C', 'C', 'C', 'M']) : pick(['s', 's', 'z', 'g', 'v', 'w', 'k']));
      else if (random() < 0.07) g.set(x, y, pick(['s', 'z', 'f', 'v', 'a']));
    }
  g.set(START.x, START.y, '@');
  return { g, notes: ['Labyrinth: one-tile corridors with loops; a pillared chamber in the middle holds a skeleton captain, archers and a large chest.'] };
}

// ---- rooms and corridors ----------------------------------------------------
function rooms() {
  const g = makeGrid(40, 40);
  const lo = 2, hi = 37;              // floor stays inside, walls and border outside
  const list = [{ x0: 10, y0: 10, x1: 14, y1: 14 }];
  const gap = 4;                      // two walls and a corridor between rooms
  for (let tries = 0; tries < 2000 && list.length < 10; tries++) {
    const w = 4 + rnd(5), h = 4 + rnd(5);
    const x0 = lo + rnd(hi - lo - w + 2), y0 = lo + rnd(hi - lo - h + 2);
    const r = { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    if (r.x1 > hi || r.y1 > hi) continue;
    if (list.some((o) => !(r.x1 + gap <= o.x0 || o.x1 + gap <= r.x0 || r.y1 + gap <= o.y0 || o.y1 + gap <= r.y0))) continue;
    list.push(r);
  }
  for (const r of list)
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) g.set(x, y, '.');
  const center = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  const inRing = (x, y) => list.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1);

  // Minimum spanning tree over the room centres, plus two loops.
  const dist2 = (a, b) => { const ca = center(a), cb = center(b); return (ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2; };
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < list.length) {
    let best = null;
    for (const a of inTree)
      for (let b = 0; b < list.length; b++)
        if (!inTree.has(b) && (!best || dist2(list[a], list[b]) < best.d)) best = { a, b, d: dist2(list[a], list[b]) };
    inTree.add(best.b);
    edges.push([best.a, best.b]);
  }
  const extra = [];
  for (let a = 0; a < list.length; a++)
    for (let b = a + 1; b < list.length; b++)
      if (!edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) extra.push([a, b, dist2(list[a], list[b])]);
  extra.sort((p, q) => p[2] - q[2]);
  edges.push(...extra.slice(0, 2).map(([a, b]) => [a, b]));

  // A door on the side of `r` that faces `toward`, and the tile outside it.
  const doors = [];
  function door(r, toward) {
    const c = center(r), t = center(toward);
    const dx = t.x - c.x, dy = t.y - c.y;
    const along = (a0, a1) => (a1 - a0 >= 2 ? a0 + 1 + rnd(a1 - a0 - 1) : a0 + rnd(a1 - a0 + 1));
    let d;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const y = along(r.y0, r.y1);
      d = dx > 0 ? { x: r.x1 + 1, y, ox: r.x1 + 2, oy: y } : { x: r.x0 - 1, y, ox: r.x0 - 2, oy: y };
    } else {
      const x = along(r.x0, r.x1);
      d = dy > 0 ? { x, y: r.y1 + 1, ox: x, oy: r.y1 + 2 } : { x, y: r.y0 - 1, ox: x, oy: r.y0 - 2 };
    }
    doors.push(d);
    return d;
  }

  // Cheapest corridor between two tiles outside the rooms: straight runs and
  // existing corridors are cheap, turns cost extra.
  const corridor = new Set();
  const key = (x, y) => y * g.w + x;
  function dig(from, to) {
    const cost = new Map();
    const prev = new Map();
    const open = heap((p, q) => p.c - q.c);
    open.push({ x: from.ox, y: from.oy, d: -1, c: 0 });
    cost.set(`${from.ox},${from.oy},-1`, 0);
    let end = null;
    while (open.size()) {
      const cur = open.pop();
      if (cur.c > cost.get(`${cur.x},${cur.y},${cur.d}`)) continue;
      if (cur.x === to.ox && cur.y === to.oy) { end = cur; break; }
      DIRS.forEach(([dx, dy], d) => {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < lo || ny < lo || nx > hi || ny > hi || inRing(nx, ny)) return;
        const step = (corridor.has(key(nx, ny)) ? 0.3 : 1) + (cur.d >= 0 && cur.d !== d ? 2 : 0);
        const k = `${nx},${ny},${d}`;
        const c = cur.c + step;
        if (cost.has(k) && cost.get(k) <= c) return;
        cost.set(k, c);
        prev.set(k, cur);
        open.push({ x: nx, y: ny, d, c });
      });
    }
    if (!end) throw new Error('no corridor between two rooms; try another seed');
    for (let p = end; p; p = prev.get(`${p.x},${p.y},${p.d}`)) {
      g.set(p.x, p.y, '.');
      corridor.add(key(p.x, p.y));
    }
  }
  for (const [a, b] of edges) {
    const da = door(list[a], list[b]), db = door(list[b], list[a]);
    dig(da, db);
  }
  for (const d of doors) g.set(d.x, d.y, random() < 0.2 ? 'A' : 'D');

  // Furnish. The boss gets the room farthest from the start.
  const dist = distances(g);
  const reach = (r) => dist.at(Math.round(center(r).x), Math.round(center(r).y)) ?? -1;
  if (list.some((r) => reach(r) < 0)) throw new Error('a room cannot be reached; try another seed');
  const boss = list.indexOf(list.slice(1).reduce((p, q) => (reach(q) > reach(p) ? q : p)));
  const area = (r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const others = list.map((r, i) => i).filter((i) => i !== 0 && i !== boss);
  const shrine = others.length > 2 ? others.reduce((p, q) => (area(list[q]) < area(list[p]) ? q : p)) : -1;
  const nearDoor = (x, y) => doors.some((d) => Math.abs(d.x - x) + Math.abs(d.y - y) <= 1);
  const freeTiles = (r, edge) => {
    const out = [];
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        const onEdge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        if (g.get(x, y) === '.' && !nearDoor(x, y) && onEdge === edge && !(x === START.x && y === START.y)) out.push([x, y]);
      }
    return shuffle(out);
  };
  const place = (r, chars, edge = false) => {
    const spots = freeTiles(r, edge);
    chars.slice(0, spots.length).forEach((ch, i) => g.set(spots[i][0], spots[i][1], ch));
  };
  const many = (n, choices) => Array.from({ length: n }, () => pick(choices));
  const themes = shuffle([
    { name: 'crypt', monsters: ['z', 'z', 'g', 'r'], objects: ['S', 'S'] },
    { name: 'camp', monsters: ['f', 'f', 'w', 'k'], objects: ['B', 'B', 'X'] },
    { name: 'barracks', monsters: ['s', 's', 'a'], objects: ['C', 'B'] },
    { name: 'den', monsters: ['v', 'v'], objects: ['X', 'B'] },
    { name: 'crypt', monsters: ['z', 'g', 'r'], objects: ['S', 'M'] },
    { name: 'camp', monsters: ['f', 'w', 'w', 'k'], objects: ['B', 'C'] },
    { name: 'barracks', monsters: ['s', 'a', 'a'], objects: ['B', 'B'] },
    { name: 'den', monsters: ['v', 'v', 'v'], objects: ['B'] },
  ]);
  const roomNotes = [];
  list.forEach((r, i) => {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    if (w >= 7 && h >= 7)
      for (const [x, y] of [[r.x0 + 2, r.y0 + 2], [r.x1 - 2, r.y0 + 2], [r.x0 + 2, r.y1 - 2], [r.x1 - 2, r.y1 - 2]]) g.set(x, y, 'P');
    if (i === 0) {
      place(r, ['B', 'B'], true);
      roomNotes.push('start');
    } else if (i === boss) {
      g.set(Math.round(center(r).x), Math.round(center(r).y), 'c');
      place(r, ['a', 'a', 'a', 's', 's']);
      place(r, ['L', 'S', 'S'], true);
      roomNotes.push('boss');
    } else if (i === shrine) {
      place(r, ['H', 'K', 'K'], true);
      roomNotes.push('shrine');
    } else {
      const t = themes.pop() ?? { name: 'camp', monsters: ['f'], objects: [] };
      place(r, many(Math.max(2, Math.round((w * h) / 7)), t.monsters));
      place(r, t.objects, true);
      roomNotes.push(t.name);
    }
  });
  for (const k of corridor) {
    const x = k % g.w, y = Math.floor(k / g.w);
    if (g.get(x, y) === '.' && random() < 0.03 && (dist.at(x, y) ?? 0) > 6) g.set(x, y, pick(['s', 'z', 'v']));
  }
  g.set(START.x, START.y, '@');
  return {
    g,
    notes: [`Rooms: ${list.length} rooms (${roomNotes.join(', ')}) joined by corridors; the skeleton captain holds the room farthest from the start.`],
  };
}

const { g, notes } = kind === 'maze' ? maze() : rooms();
const header = [...notes, `Made with: node tools/dungen.mjs ${kind} ${seed} <out.txt>`, `seed ${seed}`];
writeFileSync(outPath, header.map((l) => '; ' + l).join('\n') + '\n' + g.text());
console.log(`${outPath}: ${notes[0]}`);
