/**
 * @file autostart.cpp
 *
 * Implementation of entering a game straight from the command line.
 */
#include "autostart.h"

#include <cstddef>
#include <iterator>

#include "diablo.h"
#include "game_mode.hpp"
#include "levels/gendung.h"
#include "levels/setmaps.h"
#include "msg.h"
#include "pfile.h"
#include "player.h"
#include "quests.h"
#include "storm/storm_net.hpp"
#include "tables/questdat.hpp"
#include "utils/parse_int.hpp"
#include "utils/str_cat.hpp"

namespace devilution {

AutostartSettings Autostart;
std::string TestMapPath;

namespace {

bool AutostartEntered;
bool AutostartDunEntered;

} // namespace

bool AutostartPending()
{
	return !AutostartEntered && Autostart.multiplayer.has_value();
}

void AutostartDone()
{
	AutostartEntered = true;
}

bool AutostartDunPending()
{
	return !AutostartDunEntered && !Autostart.dunPath.empty();
}

void AutostartDunDone()
{
	AutostartDunEntered = true;
}

std::expected<void, std::string> AutostartEnterDun()
{
	AutostartDunDone();

	// The level the game started in is saved off and recorded as the one to
	// return to, the same way entering a quest level from it would.
	// Note: ReturnLevel, ReturnLevelType and ReturnLvlPosition is only set to
	// ensure vanilla compatibility
	ReturnLevel = GetMapReturnLevel();
	ReturnLevelType = GetLevelType(ReturnLevel);
	ReturnLvlPosition = GetMapReturnPosition();
	if (!gbIsMultiplayer) {
		pfile_save_level();
	} else {
		DeltaSaveLevel();
	}

	TestMapPath = StrCat(Autostart.dunPath, ".dun");
	setlevel = true;
	setlvlnum = SL_NONE;
	setlvltype = Autostart.dunType;
	leveltype = setlvltype;
	currlevel = static_cast<uint8_t>(setlvlnum);
	ViewPosition = Autostart.dunSpawn;
	MyPlayer->setLevel(setlvlnum);

	// Loading the custom level clears the dungeon arrays and stands the player
	// on the spawn position, so nothing of the level being left has to be
	// unwound first.
	FreeGameMem();
	return LoadGameLevel(false, ENTRY_SETLVL);
}

bool AutostartSetGameMode(std::string_view value)
{
	if (value == "single" || value == "singleplayer") {
		Autostart.multiplayer = false;
	} else if (value == "multi" || value == "multiplayer") {
		Autostart.multiplayer = true;
	} else {
		return false;
	}
	return true;
}

bool AutostartSetConnection(std::string_view value)
{
	if (value == "offline" || value == "loopback") {
		Autostart.provider = SELCONN_LOOPBACK;
	} else if (value == "tcp") {
		Autostart.provider = SELCONN_TCP;
	} else if (value == "zerotier" || value == "zt") {
		Autostart.provider = SELCONN_ZT;
	} else {
		return false;
	}
	return true;
}

bool AutostartSetDifficulty(std::string_view value)
{
	if (value == "normal") {
		Autostart.difficulty = DIFF_NORMAL;
	} else if (value == "nightmare") {
		Autostart.difficulty = DIFF_NIGHTMARE;
	} else if (value == "hell") {
		Autostart.difficulty = DIFF_HELL;
	} else {
		return false;
	}
	return true;
}

bool AutostartSetDunType(std::string_view value)
{
	// Indexed by dungeon_type, which starts at DTYPE_TOWN.
	static constexpr std::string_view TypeNames[] = {
		"town", "cathedral", "catacombs", "caves", "hell", "nest", "crypt"
	};
	for (size_t i = 0; i < std::size(TypeNames); ++i) {
		if (value == TypeNames[i]) {
			Autostart.dunType = static_cast<dungeon_type>(i);
			return true;
		}
	}

	const ParseIntResult<int> parsed = ParseInt<int>(value, DTYPE_TOWN, DTYPE_LAST);
	if (!parsed.has_value())
		return false;
	Autostart.dunType = static_cast<dungeon_type>(parsed.value());
	return true;
}

bool AutostartSetDunPal(std::string_view value)
{
	// LoadRndLvlPal builds the file name in a fixed buffer, so keep this to
	// the two digits that fits.
	const ParseIntResult<int> parsed = ParseInt<int>(value, 1, 99);
	if (!parsed.has_value())
		return false;
	Autostart.dunPal = parsed.value();
	return true;
}

bool AutostartSetDunSpawn(std::string_view value)
{
	const size_t separator = value.find(',');
	if (separator == std::string_view::npos)
		return false;

	const ParseIntResult<int> x = ParseInt<int>(value.substr(0, separator));
	const ParseIntResult<int> y = ParseInt<int>(value.substr(separator + 1));
	if (!x.has_value() || !y.has_value())
		return false;

	const Point spawn { x.value(), y.value() };
	if (!InDungeonBounds(spawn))
		return false;

	Autostart.dunSpawn = spawn;
	return true;
}

} // namespace devilution
