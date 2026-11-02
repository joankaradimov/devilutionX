// Turns an ASCII cathedral map into a Diablo .dun, running the passes that
// DevilutionX's own cathedral generator (Source/levels/drlg_l1.cpp) runs on a
// random level, in the same order. The tile enum and the shadow/decoration
// tables are read out of drlg_l1.cpp itself.
//
//   node tools/dunmaker.mjs <map.txt> [<out.dun>]
//
// The output defaults to the map's name with .dun, e.g.
// Packaging/emscripten/levels/chapel.txt -> chapel.dun, which the web build
// packages under /levels.
//
// Map legend, one character per megatile:
//   ' ' '#'  solid          '.'  floor            'P'  pillar
//   'D'      door in a one-tile wall between two floors
//   'A'      archway in such a wall
//   '@'      player start (floor)
//   monsters (floor): z zombie, g ghoul, r rotting carcass, f fallen (spear),
//     w fallen (sword), k carver, s skeleton, a skeleton archer,
//     c skeleton captain, v scavenger, e fiend
//   objects (floor): B barrel, X explosive barrel, C small chest,
//     M medium chest, L large chest, S sarcophagus, H shrine, K candle
// Lines starting with ';' are comments, except "; seed <n>", which seeds the
// random wall and floor decorations.
import { readFileSync, writeFileSync } from 'node:fs';

const [mapPath, outArg] = process.argv.slice(2);
if (!mapPath) {
  console.error('usage: node tools/dunmaker.mjs <map.txt> [<out.dun>]');
  process.exit(2);
}
const outPath = outArg ?? mapPath.replace(/\.[^./\\]*$/, '') + '.dun';
const srcPath = new URL('../Source/levels/drlg_l1.cpp', import.meta.url);
const src = readFileSync(srcPath, 'utf8').replace(/\r/g, '');

// ---- tables from drlg_l1.cpp ------------------------------------------------
const T = {};
for (const m of src.slice(src.indexOf('enum Tile : uint8_t {')).split('};')[0].matchAll(/(\w+)\s*=\s*(\d+),/g))
  T[m[1]] = Number(m[2]);
const val = (tok) => (/^\d+$/.test(tok) ? Number(tok) : (tok in T ? T[tok] : (() => { throw new Error('unknown ' + tok); })()));
function arrayBody(name) {
  const start = src.indexOf(name);
  if (start < 0) throw new Error('missing ' + name);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(open + 1, i).replace(/\/\/.*$/gm, '');
}
const tokens = (body) => body.split(/[\s,{}]+/).filter(Boolean);
const BaseTypes = tokens(arrayBody('const uint8_t BaseTypes[207]')).map(val);
const TileDecorations = tokens(arrayBody('const uint8_t TileDecorations[207]')).map(val);
const ShadowPatterns = [...arrayBody('const ShadowStruct ShadowPatterns[37]').matchAll(/\{([^}]*)\}/g)]
  .map((m) => tokens(m[1]).map(val))
  .map(([strig, s1, s2, s3, nv1, nv2, nv3]) => ({ strig, s1, s2, s3, nv1, nv2, nv3 }));
if (BaseTypes.length !== 207 || TileDecorations.length !== 207 || ShadowPatterns.length !== 37)
  throw new Error(`table sizes ${BaseTypes.length} ${TileDecorations.length} ${ShadowPatterns.length}`);

// ---- map --------------------------------------------------------------------
const DMAXX = 40, DMAXY = 40, MAXDUN = 112;
let seed = 1;
const rows = [];
for (const line of readFileSync(mapPath, 'utf8').replace(/\r/g, '').split('\n')) {
  const d = line.match(/^;\s*seed\s+(\d+)/);
  if (d) seed = Number(d[1]);
  else if (!line.startsWith(';')) rows.push(line.replace(/\s+$/, ''));
}
while (rows.length && rows[rows.length - 1] === '') rows.pop();
const H = rows.length, W = Math.max(...rows.map((r) => r.length));
if (W > DMAXX || H > DMAXY) throw new Error(`map is ${W}x${H}, at most ${DMAXX}x${DMAXY}`);
const at = (x, y) => (y >= 0 && y < H && x >= 0 && x < rows[y].length ? rows[y][x] : ' ');

const MONSTERS = { z: 1, g: 2, r: 3, f: 5, k: 6, s: 9, w: 13, v: 17, a: 21, c: 25, e: 37 };
const OBJECTS = { B: 118, X: 119, C: 77, M: 80, L: 83, S: 117, H: 127, K: 19 };
const isFloorChar = (ch) => ch === '.' || ch === 'P' || ch === '@' || ch in MONSTERS || ch in OBJECTS;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const ch = at(x, y);
    if (!(ch === ' ' || ch === '#' || ch === 'D' || ch === 'A' || isFloorChar(ch)))
      throw new Error(`unknown map character '${ch}' at ${x},${y}`);
    if (isFloorChar(ch) && (x === 0 || y === 0 || x === W - 1 || y === H - 1))
      throw new Error(`floor at the map edge ${x},${y}: leave a solid border`);
  }

// ---- generator state, as in drlg_l1.cpp ------------------------------------
const grid = (w, h, v) => Array.from({ length: w }, () => new Array(h).fill(v));
const dungeon = grid(DMAXX, DMAXY, T.Dirt);
const Protected = grid(DMAXX, DMAXY, false);
const mask = grid(DMAXX, DMAXY, false);
const dTransVal = grid(MAXDUN, MAXDUN, 0);
let TransVal = 1;
let rngState = seed >>> 0;
const GenerateRnd = (n) => { rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0; return (rngState >>> 8) % n; };
const FlipCoin = (n = 2) => GenerateRnd(n) === 0;
const IsAnyOf = (v, ...xs) => xs.includes(v);

for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    mask[x][y] = isFloorChar(at(x, y));
const M = (x, y) => x >= 0 && y >= 0 && x < DMAXX && y < DMAXY && mask[x][y];

function MakeDmt() {
  for (let j = 0; j < DMAXY - 1; j++)
    for (let i = 0; i < DMAXX - 1; i++) {
      if (M(i, j)) dungeon[i][j] = T.Floor;
      else if (!M(i + 1, j + 1) && M(i, j + 1) && M(i + 1, j)) dungeon[i][j] = T.Floor;
      else if (M(i + 1, j + 1) && M(i, j + 1) && M(i + 1, j)) dungeon[i][j] = T.VCorner;
      else if (M(i, j + 1)) dungeon[i][j] = T.HWall;
      else if (M(i + 1, j)) dungeon[i][j] = T.VWall;
      else if (M(i + 1, j + 1)) dungeon[i][j] = T.DWall;
      else dungeon[i][j] = T.Dirt;
    }
}

function FixTilesPatterns() {
  const d = dungeon;
  for (let j = 0; j < DMAXY; j++)
    for (let i = 0; i < DMAXX; i++) {
      if (i + 1 < DMAXX) {
        if (d[i][j] === T.HWall && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.DirtHwallEnd;
        if (d[i][j] === T.Floor && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.DirtHwall;
        if (d[i][j] === T.Floor && d[i + 1][j] === T.HWall) d[i + 1][j] = T.HWallEnd;
        if (d[i][j] === T.VWallEnd && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.DirtVwallEnd;
      }
      if (j + 1 < DMAXY) {
        if (d[i][j] === T.VWall && d[i][j + 1] === T.Dirt) d[i][j + 1] = T.DirtVwallEnd;
        if (d[i][j] === T.Floor && d[i][j + 1] === T.VWall) d[i][j + 1] = T.VWallEnd;
        if (d[i][j] === T.Floor && d[i][j + 1] === T.Dirt) d[i][j + 1] = T.DirtVwall;
      }
    }
  for (let j = 0; j < DMAXY; j++)
    for (let i = 0; i < DMAXX; i++) {
      if (i + 1 < DMAXX) {
        if (d[i][j] === T.Floor && d[i + 1][j] === T.DirtVwall) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.Floor && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.VDirtCorner;
        if (d[i][j] === T.HWallEnd && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.DirtHwallEnd;
        if (d[i][j] === T.Floor && d[i + 1][j] === T.DirtVwallEnd) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.DirtVwall && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.VDirtCorner;
        if (d[i][j] === T.HWall && d[i + 1][j] === T.DirtVwall) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.DirtVwall && d[i + 1][j] === T.VWall) d[i + 1][j] = T.VWallEnd;
        if (d[i][j] === T.HWallEnd && d[i + 1][j] === T.DirtVwall) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.HWall && d[i + 1][j] === T.VWall) d[i + 1][j] = T.VWallEnd;
        if (d[i][j] === T.Corner && d[i + 1][j] === T.Dirt) d[i + 1][j] = T.DirtVwallEnd;
        if (d[i][j] === T.HDirtCorner && d[i + 1][j] === T.VWall) d[i + 1][j] = T.VWallEnd;
        if (d[i][j] === T.HWallEnd && d[i + 1][j] === T.VWall) d[i + 1][j] = T.VWallEnd;
        if (d[i][j] === T.HWallEnd && d[i + 1][j] === T.DirtVwallEnd) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.DWall && d[i + 1][j] === T.VCorner) d[i + 1][j] = T.HCorner;
        if (d[i][j] === T.HWallEnd && d[i + 1][j] === T.Floor) d[i + 1][j] = T.HCorner;
        if (d[i][j] === T.HWall && d[i + 1][j] === T.DirtVwallEnd) d[i + 1][j] = T.HDirtCorner;
        if (d[i][j] === T.HWall && d[i + 1][j] === T.Floor) d[i + 1][j] = T.HCorner;
      }
      if (i > 0) {
        if (d[i][j] === T.DirtHwallEnd && d[i - 1][j] === T.Dirt) d[i - 1][j] = T.DirtVwall;
        if (d[i][j] === T.DirtVwall && d[i - 1][j] === T.DirtHwallEnd) d[i - 1][j] = T.HDirtCorner;
        if (d[i][j] === T.VWallEnd && d[i - 1][j] === T.Dirt) d[i - 1][j] = T.DirtVwallEnd;
        if (d[i][j] === T.VWallEnd && d[i - 1][j] === T.DirtHwallEnd) d[i - 1][j] = T.HDirtCorner;
      }
      if (j + 1 < DMAXY) {
        if (d[i][j] === T.VWall && d[i][j + 1] === T.HWall) d[i][j + 1] = T.HWallEnd;
        if (d[i][j] === T.VWallEnd && d[i][j + 1] === T.DirtHwall) d[i][j + 1] = T.HDirtCorner;
        if (d[i][j] === T.DirtHwall && d[i][j + 1] === T.HWall) d[i][j + 1] = T.HWallEnd;
        if (d[i][j] === T.VWallEnd && d[i][j + 1] === T.HWall) d[i][j + 1] = T.HWallEnd;
        if (d[i][j] === T.HDirtCorner && d[i][j + 1] === T.HWall) d[i][j + 1] = T.HWallEnd;
        if (d[i][j] === T.VWallEnd && d[i][j + 1] === T.Dirt) d[i][j + 1] = T.DirtVwallEnd;
        if (d[i][j] === T.VWallEnd && d[i][j + 1] === T.Floor) d[i][j + 1] = T.VCorner;
        if (d[i][j] === T.VWall && d[i][j + 1] === T.Floor) d[i][j + 1] = T.VCorner;
        if (d[i][j] === T.Floor && d[i][j + 1] === T.VCorner) d[i][j + 1] = T.HCorner;
      }
      if (j > 0) {
        if (d[i][j] === T.VWallEnd && d[i][j - 1] === T.Dirt) d[i][j - 1] = T.HWallEnd;
        if (d[i][j] === T.VWallEnd && d[i][j - 1] === T.Dirt) d[i][j - 1] = T.DirtVwallEnd;
        if (d[i][j] === T.HWallEnd && d[i][j - 1] === T.DirtVwallEnd) d[i][j - 1] = T.HDirtCorner;
        if (d[i][j] === T.DirtHwall && d[i][j - 1] === T.DirtVwallEnd) d[i][j - 1] = T.HDirtCorner;
      }
    }
  for (let j = 0; j < DMAXY; j++)
    for (let i = 0; i < DMAXX; i++) {
      if (j + 1 < DMAXY && d[i][j] === T.DWall && d[i][j + 1] === T.HWall) d[i][j + 1] = T.HWallEnd;
      if (i + 1 < DMAXX && d[i][j] === T.HWall && d[i + 1][j] === T.DirtVwall) d[i + 1][j] = T.HDirtCorner;
      if (j + 1 < DMAXY && d[i][j] === T.DirtHwall && d[i][j + 1] === T.Dirt) d[i][j + 1] = T.VDirtCorner;
    }
}

// Doors and arches go in after FixTilesPatterns, where AddWall puts its own.
function PlaceDoors() {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = at(x, y);
      if (ch !== 'D' && ch !== 'A') continue;
      const horizontal = isFloorChar(at(x, y - 1)) && isFloorChar(at(x, y + 1));
      const vertical = isFloorChar(at(x - 1, y)) && isFloorChar(at(x + 1, y));
      if (horizontal === vertical) throw new Error(`'${ch}' at ${x},${y} needs floor on exactly two opposite sides`);
      if (ch === 'D') {
        dungeon[x][y] = horizontal ? T.HDoor : T.VDoor;
        Protected[x][y] = true;
      } else {
        dungeon[x][y] = horizontal ? T.HArch : T.VArch;
      }
    }
}

// Pillars go in before FixTilesPatterns, where FillChambers puts its own.
function PlacePillars() {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (at(x, y) === 'P') dungeon[x][y] = T.Pillar;
}

// gendung.cpp: FloodTransparencyValues / FindTransparencyValues / FillTransparencyValues
function IsFloor(px, py, floorID) {
  const i = Math.trunc((px - 16) / 2), j = Math.trunc((py - 16) / 2);
  if (i < 0 || i >= DMAXX || j < 0 || j >= DMAXY) return false;
  return dungeon[i][j] === floorID;
}
const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
function FillTransparencyValues(fx, fy, floorID) {
  for (const [dx, dy] of DIRS)
    if (!IsFloor(fx + dx, fy + dy, floorID)) dTransVal[fx + dx][fy + dy] = TransVal;
  dTransVal[fx][fy] = TransVal;
}
function FindTransparencyValues(fx, fy, floorID) {
  const stack = [{ scanStart: fx, scanEnd: fx + 1, y: fy, dy: 1 }];
  const isInside = (x, y) => dTransVal[x][y] === 0 && IsFloor(x, y, floorID);
  const set = (x, y) => FillTransparencyValues(x, y, floorID);
  const checkDiagonals = (px, py, dir) => {
    if (!isInside(px, py - 1) && isInside(px + dir, py - 1)) stack.push({ scanStart: px + dir, scanEnd: px + dir + 1, y: py - 1, dy: -1 });
    if (!isInside(px, py + 1) && isInside(px + dir, py + 1)) stack.push({ scanStart: px + dir, scanEnd: px + dir + 1, y: py + 1, dy: 1 });
  };
  while (stack.length) {
    const { scanStart, scanEnd, y, dy } = stack.pop();
    let scanLeft = scanStart;
    if (isInside(scanLeft, y)) {
      while (isInside(scanLeft - 1, y)) { set(scanLeft - 1, y); scanLeft--; }
      checkDiagonals(scanLeft, y, -1);
    }
    if (scanLeft < scanStart) stack.push({ scanStart: scanLeft, scanEnd: scanStart - 1, y: y - dy, dy: -dy });
    let scanRight = scanStart;
    while (scanRight < scanEnd) {
      while (isInside(scanRight, y)) { set(scanRight, y); scanRight++; }
      stack.push({ scanStart: scanLeft, scanEnd: scanRight - 1, y: y + dy, dy });
      if (scanRight - 1 > scanEnd) stack.push({ scanStart: scanEnd + 1, scanEnd: scanRight - 1, y: y - dy, dy: -dy });
      if (scanLeft < scanRight) checkDiagonals(scanRight - 1, y, 1);
      while (scanRight < scanEnd && !isInside(scanRight, y)) scanRight++;
      scanLeft = scanRight;
      if (scanLeft < scanEnd) checkDiagonals(scanLeft, y, -1);
    }
  }
}
function FloodTransparencyValues(floorID) {
  let yy = 16;
  for (let j = 0; j < DMAXY; j++) {
    let xx = 16;
    for (let i = 0; i < DMAXX; i++) {
      if (dungeon[i][j] === floorID && dTransVal[xx][yy] === 0) {
        FindTransparencyValues(xx, yy, floorID);
        TransVal++;
      }
      xx += 2;
    }
    yy += 2;
  }
}

function FixTransparency() {
  let yy = 16;
  for (let j = 0; j < DMAXY; j++) {
    let xx = 16;
    for (let i = 0; i < DMAXX; i++) {
      const t = dTransVal[xx][yy];
      if (dungeon[i][j] === T.DirtHwallEnd && j > 0 && dungeon[i][j - 1] === T.DirtHwall) { dTransVal[xx + 1][yy] = t; dTransVal[xx + 1][yy + 1] = t; }
      if (dungeon[i][j] === T.DirtVwallEnd && i + 1 < DMAXY && dungeon[i + 1][j] === T.DirtVwall) { dTransVal[xx][yy + 1] = t; dTransVal[xx + 1][yy + 1] = t; }
      if (dungeon[i][j] === T.DirtHwall) { dTransVal[xx + 1][yy] = t; dTransVal[xx + 1][yy + 1] = t; }
      if (dungeon[i][j] === T.DirtVwall) { dTransVal[xx][yy + 1] = t; dTransVal[xx + 1][yy + 1] = t; }
      if (dungeon[i][j] === T.VDirtCorner) { dTransVal[xx + 1][yy] = t; dTransVal[xx][yy + 1] = t; dTransVal[xx + 1][yy + 1] = t; }
      xx += 2;
    }
    yy += 2;
  }
}

function FixDirtTiles() {
  const d = dungeon;
  for (let j = 0; j < DMAXY - 1; j++)
    for (let i = 0; i < DMAXX - 1; i++) {
      if (d[i][j] === T.HDirtCorner && d[i + 1][j] !== T.DirtVwall) d[i][j] = T.DirtCorner2;
      if (d[i][j] === T.DirtVwall && d[i + 1][j] !== T.DirtVwall) d[i][j] = T.DirtVWall2;
      if (d[i][j] === T.DirtVwallEnd && d[i + 1][j] !== T.DirtVwall) d[i][j] = T.DirtVWallEnd2;
      if (d[i][j] === T.DirtHwall && d[i][j + 1] !== T.DirtHwall) d[i][j] = T.DirtHWall2;
      if (d[i][j] === T.HDirtCorner && d[i][j + 1] !== T.DirtHwall) d[i][j] = T.DirtCorner2;
      if (d[i][j] === T.DirtHwallEnd && d[i][j + 1] !== T.DirtHwall) d[i][j] = T.DirtHWallEnd2;
    }
}

function FixCornerTiles() {
  const d = dungeon;
  for (let j = 1; j < DMAXY - 1; j++)
    for (let i = 1; i < DMAXX - 1; i++) {
      if (!Protected[i][j] && d[i][j] === T.HCorner && d[i - 1][j] === T.Floor && d[i][j - 1] === T.VWall) d[i][j] = T.VCorner;
      if (d[i][j] === T.DirtCorner2 && d[i + 1][j] === T.Floor && d[i][j + 1] === T.VWall) d[i][j] = T.HArchEnd;
      if (d[i][j] === T.DirtCorner2 && d[i][j + 1] === T.Floor && d[i + 1][j] === T.HWall) d[i][j] = T.VArchEnd;
    }
}

function Substitution() {
  for (let y = 0; y < DMAXY; y++)
    for (let x = 0; x < DMAXX; x++) {
      if (!FlipCoin(4)) continue;
      const c = TileDecorations[dungeon[x][y]];
      if (c === 0 || Protected[x][y]) continue;
      let rv = GenerateRnd(16);
      let i = -1;
      while (rv >= 0) {
        i++;
        if (i === TileDecorations.length) i = 0;
        if (c === TileDecorations[i]) rv--;
      }
      if (i === T.VWall4 && y > 0) {
        if (TileDecorations[dungeon[x][y - 1]] !== T.VWall2 || Protected[x][y - 1]) i = T.VWall2;
        else dungeon[x][y - 1] = T.VWall5;
      }
      if (i === T.HWall4 && x + 1 < DMAXX) {
        if (TileDecorations[dungeon[x + 1][y]] !== T.HWall2 || Protected[x + 1][y]) i = T.HWall2;
        else dungeon[x + 1][y] = T.HWall5;
      }
      dungeon[x][y] = i;
    }
}

function ApplyShadowsPatterns() {
  for (let y = 1; y < DMAXY; y++)
    for (let x = 1; x < DMAXX; x++) {
      const s00 = BaseTypes[dungeon[x][y]], s10 = BaseTypes[dungeon[x - 1][y]];
      const s01 = BaseTypes[dungeon[x][y - 1]], s11 = BaseTypes[dungeon[x - 1][y - 1]];
      for (const p of ShadowPatterns) {
        if (p.strig !== s00) continue;
        if (p.s1 !== 0 && p.s1 !== s11) continue;
        if (p.s2 !== 0 && p.s2 !== s01) continue;
        if (p.s3 !== 0 && p.s3 !== s10) continue;
        if (p.nv1 !== 0 && !Protected[x - 1][y - 1]) dungeon[x - 1][y - 1] = p.nv1;
        if (p.nv2 !== 0 && !Protected[x][y - 1]) dungeon[x][y - 1] = p.nv2;
        if (p.nv3 !== 0 && !Protected[x - 1][y]) dungeon[x - 1][y] = p.nv3;
      }
    }
  const fence = (v) => IsAnyOf(v, T.DFence, T.VFenceEnd, T.VFence, T.HWallVFence, T.HArchVFence, T.HArchVDoor);
  for (let y = 1; y < DMAXY; y++)
    for (let x = 1; x < DMAXX; x++) {
      if (Protected[x - 1][y]) continue;
      if (dungeon[x - 1][y] === T.Floor12) dungeon[x - 1][y] = fence(dungeon[x][y]) ? T.Floor14 : T.Floor12;
      if (dungeon[x - 1][y] === T.HArchShadow) dungeon[x - 1][y] = fence(dungeon[x][y]) ? T.HArchShadow2 : T.HArchShadow;
      if (dungeon[x - 1][y] === T.HWallShadow) dungeon[x - 1][y] = fence(dungeon[x][y]) ? T.HWallShadow2 : T.HWallShadow;
    }
}

// ---- the pipeline, in GenerateLevel's order ---------------------------------
MakeDmt();
PlacePillars();        // FillChambers
FixTilesPatterns();
PlaceDoors();          // AddWall
FloodTransparencyValues(T.Floor);
FixTransparency();
FixDirtTiles();
FixCornerTiles();
Substitution();
ApplyShadowsPatterns();

// ---- write the .dun ---------------------------------------------------------
const W2 = W * 2, H2 = H * 2;
const out = new Uint16Array(2 + W * H + 4 * W2 * H2);
out[0] = W; out[1] = H;
let o = 2;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const t = dungeon[x][y];
    out[o++] = t === T.Floor ? 0 : t; // 0 lets the loader vary the floor
  }
const layer = (n) => 2 + W * H + n * W2 * H2;
const counts = { monsters: 0, objects: 0 };
let start = null;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const ch = at(x, y);
    const idx = 2 * y * W2 + 2 * x;
    if (ch in MONSTERS) { out[layer(1) + idx] = MONSTERS[ch]; counts.monsters++; }
    if (ch in OBJECTS) { out[layer(2) + idx + W2 + 1] = OBJECTS[ch]; counts.objects++; }
    if (ch === '@') start = { x: 16 + 2 * x + 1, y: 16 + 2 * y + 1 };
  }
for (let j = 0; j < H2; j++)
  for (let i = 0; i < W2; i++)
    out[layer(3) + j * W2 + i] = dTransVal[16 + i][16 + j] & 0xff;

writeFileSync(outPath, Buffer.from(out.buffer));
const rooms = TransVal - 1;
const defaultStartOk = isFloorChar(at(12, 12)) && at(12, 12) !== 'P';
console.log(`${outPath}: ${W}x${H}, ${counts.monsters} monsters, ${counts.objects} objects, ${rooms} transparency regions` +
  (start ? `, start dun-pos=${start.x},${start.y}` : '') +
  (defaultStartOk ? ' (default start 40,40 is on floor)' : ' (default start 40,40 is NOT on floor: pass dun-pos)'));
