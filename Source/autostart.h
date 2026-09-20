/**
 * @file autostart.h
 *
 * Entering a game straight from the command line, skipping the menus that
 * would otherwise have to be clicked through.
 */
#pragma once

#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <string_view>

#include "engine/point.hpp"
#include "levels/gendung_defs.hpp"

namespace devilution {

/** @brief Choices taken from the command line instead of from the menus. */
struct AutostartSettings {
	/** @brief Mode to enter, set by --game-mode. Nothing below applies without it. */
	std::optional<bool> multiplayer;
	/**
	 * @brief Network provider, set by --connection. Multiplayer only.
	 *
	 * A `conn_type`, held as its underlying type so that this header does not
	 * have to pull in the networking headers.
	 */
	std::optional<uint8_t> provider;
	/** @brief Save slot to enter the game with, set by --load-save. */
	std::optional<uint32_t> saveNumber;
	/** @brief Difficulty to create the game with, set by --difficulty. */
	std::optional<_difficulty> difficulty;
	/** @brief Level file to enter, without the ".dun" suffix. Set by --dun. */
	std::string dunPath;
	/** @brief Tileset the --dun level is drawn with, set by --dun-type. */
	dungeon_type dunType = DTYPE_CATHEDRAL;
	/** @brief Where the player appears in the --dun level, set by --dun-pos. */
	Point dunSpawn { 40, 40 };
	/** @brief Palette variant for the --dun level, set by --dun-pal. */
	std::optional<int> dunPal;
};

extern AutostartSettings Autostart;

/**
 * @brief Level file to load in place of a generated one, or empty.
 *
 * Set by --dun, and by the `dev.level.warp.map` debug command.
 */
extern std::string TestMapPath;

/**
 * @brief True while the command line is still asking for a game to be entered.
 *
 * Goes false once a game has been entered, so that leaving it brings up the
 * real main menu instead of starting over.
 */
bool AutostartPending();

/** @brief Stops the command line from entering a game again. */
void AutostartDone();

/** @brief True if --dun named a level that has not been entered yet. */
bool AutostartDunPending();

/** @brief Stops the command line from warping to the --dun level again. */
void AutostartDunDone();

/**
 * @brief Loads the --dun level over the one the game has just loaded.
 *
 * Must be called from the load screen that enters the game, once the level
 * the character starts in is in place: the custom level is loaded around a
 * loaded player, which is why it cannot come any earlier. Doing it there
 * keeps both loads behind the one load screen, so the starting level is
 * never shown.
 */
std::expected<void, std::string> AutostartEnterDun();

/**
 * @brief Parses a --game-mode value ("single" or "multi").
 * @return false if the value names no known mode, leaving the setting alone.
 */
bool AutostartSetGameMode(std::string_view value);

/**
 * @brief Parses a --connection value ("offline", "tcp" or "zerotier").
 * @return false if the value names no known provider.
 */
bool AutostartSetConnection(std::string_view value);

/**
 * @brief Parses a --difficulty value ("normal", "nightmare" or "hell").
 * @return false if the value names no known difficulty.
 */
bool AutostartSetDifficulty(std::string_view value);

/**
 * @brief Parses a --dun-type value, either a tileset name or its number.
 * @return false if the value names no known tileset.
 */
bool AutostartSetDunType(std::string_view value);

/**
 * @brief Parses a --dun-pos value of the form "x,y".
 * @return false if the value is malformed or outside the dungeon.
 */
bool AutostartSetDunSpawn(std::string_view value);

/**
 * @brief Parses a --dun-pal value, the palette variant to use.
 * @return false if the value is not a number in range.
 */
bool AutostartSetDunPal(std::string_view value);

} // namespace devilution
