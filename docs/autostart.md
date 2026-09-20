## Introduction

The game normally opens on the title screen, and reaching a character means walking through the main menu, the connection dialog, the character list, the difficulty list and the game speed list. The autostart parameters make those choices on the command line instead, so the game can be started directly in a given character and level.

Unlike the `+` debug commands described in [debug.md](debug.md), these are available in every build, not only debug ones.

## Command-line parameters

| Parameter | Description |
| --------- | ----------- |
| `--game-mode <mode>` | `single` or `multi`. Skips the main menu. Nothing else here takes effect without it. |
| `--connection <name>` | `offline`, `tcp` or `zerotier`. Skips the connection dialog. Multiplayer only. Defaults to `offline`. |
| `--load-save <#>` | Save slot to enter the game with. Skips the character list. Defaults to the character played last. |
| `--difficulty <name>` | `normal`, `nightmare` or `hell`. Skips the difficulty and game speed lists. Defaults to `normal`. |
| `--dun <path>` | Enter the level in `<path>.dun` instead of a generated one. |
| `--dun-type <name>` | Tileset and palette family for `--dun`: `town`, `cathedral`, `catacombs`, `caves`, `hell`, `nest` or `crypt`, or the number of one. Defaults to `cathedral`. |
| `--dun-pos <x,y>` | Where to stand in the `--dun` level. Defaults to `40,40`. |
| `--dun-pal <#>` | Palette variant for `--dun`, from 1 to 99. Defaults to a random one. |

## Starting a game

`--game-mode` is the switch that turns menu skipping on; the other parameters fill in choices that would otherwise be asked for, and anything left out uses the default in the table above.

```
devilutionx --game-mode multi --load-save 0
```

The save slot is the number in the save file name, so `--load-save 0` is `single_0.sv` in single player and `multi_0.sv` in multiplayer, or `spawn_0.sv` and `share_0.sv` in shareware.

`--connection` only has providers to choose from where the build has them. Emscripten sets `DISABLE_TCP` and `DISABLE_ZERO_TIER`, so `offline` is the only one there.

These choices apply to the first game only. Once it has been entered, leaving to the main menu brings up the real menu, so the parameters cannot trap you in a loop of re-entering the same game.

Note that multiplayer loads the character out of the save but always generates a fresh world. Only single player continues a saved game.

### When the save is missing

`--load-save` pointing at a slot with no character in it shows the character dialog instead of entering the game, because reading an empty slot is otherwise fatal. The main menu is still skipped, so this lands on the character list rather than the title screen.

## Custom levels

`--dun` names a `.dun` file without its extension, relative to the asset root, using `\` as the separator:

```
devilutionx --game-mode multi --load-save 0 --dun "arena\church" --dun-type cathedral
```

The custom level is loaded around a loaded player, the same way the `dev.level.warp.map` debug command does it, so the level the character starts in has to be loaded first and is then immediately replaced. Both loads run behind the one load screen that enters the game, so the starting level is never shown and the game opens in the custom level.

`--dun-type` chooses both the tileset the file is parsed and drawn with and the palette family. `town` is accepted because it is a level type, but it loads no level data at all, so it is not useful for a custom level.

### Palettes

Most level types have several palettes, and one is picked at random on every load. The same level therefore comes up in different colours from run to run, which is worth knowing when comparing screenshots. `--dun-pal` pins the choice.

| Level type | Palette file |
| ---------- | ------------ |
| `town` | `levels\towndata\town.pal`, the only one |
| `crypt` | `nlevels\l5data\l5base.pal`, the only one |
| `nest` | `nlevels\l6data\l6base<#>.pal` |
| everything else | `levels\l<n>data\l<n>_<#>.pal` |

`--dun-pal` is ignored for town and crypt, which have a single palette each.

For `nest`, a randomly chosen variant is shifted up by one when the "alternate nest art" graphics option is off. A variant given with `--dun-pal` names the file outright and is never shifted.

### Adding a palette

There is no list of known palettes. The file name is built from the number, so any number in range is tried, and the only thing that can fail is opening the file. Dropping `assets/levels/l1data/l1_5.pal` in place is enough to make `--dun-pal 5` work, and a loose `.pal` does not count as an overridden logic asset, so it does not lock multiplayer out the way a loose `.lua`, `.tsv` or `.sol` would.

The file needs 256 colour entries; a shorter one fails to load. A number with no file behind it is a fatal error that names the path it looked for.

The random roll stays between 1 and 4, so an added palette is only ever reached by asking for it.

## Emscripten

The web entry point turns its query string into these parameters, so opening

```
index.html?game-mode=single&load-save=2
```

runs the game as `--game-mode single --load-save 2`. Every parameter above is accepted under its own name, without the leading dashes. `?menu` passes nothing and starts at the title screen. With no query string at all, the page falls back to `DEFAULT_FLAGS` in `Packaging/emscripten/index.html`, which is where to change the character the page opens by default.

The page also passes `-n`, which skips the logo, the intro movie and the title screen.

Since the parameters are read from the URL, trying a different one only takes a reload. Any static file server over the build output is enough for that, as long as it serves `.wasm` as `application/wasm`.
