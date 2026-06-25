import { DisplayValueHeader } from 'pixel_combats/basic';
import { Game, Players, Inventory, LeaderBoard, BuildBlocksSet, Teams, Damage, BreackGraph, Ui, Properties, GameMode, Spawns, Timers, TeamsBalancer, NewGame, NewGameVote, AreaPlayerTriggerService } from 'pixel_combats/room';
import * as teams from './default_teams.js';

const WaitingPlayersTime = 10;
const BuildBaseTime = 30;
const KnivesModeTime = 40;
const GameModeTime = 300;
const MockModeTime = 30;
const EndOfMatchTime = 8;
const VoteTime = 20;
const maxDeaths = Players.MaxCount * 5;

const WaitingStateValue = "Waiting";
const BuildModeStateValue = "BuildMode";
const KnivesModeStateValue = "KnivesMode";
const GameStateValue = "Game";
const MockModeStateValue = "MockMode";
const EndOfMatchStateValue = "EndOfMatch";
const immortalityTimerName = "immortality";

let IS_RIOT = false;

const mainTimer = Timers.GetContext().Get("Main");
const stateProp = Properties.GetContext().Get("State");

Damage.GetContext().FriendlyFire.Value = GameMode.Parameters.GetBool("FriendlyFire");
const MapRotation = GameMode.Parameters.GetBool("MapRotation");
BreackGraph.WeakBlocks = GameMode.Parameters.GetBool("LoosenBlocks");
BreackGraph.OnlyPlayerBlocksDmg = GameMode.Parameters.GetBool("OnlyPlayerBlocksDmg");

BreackGraph.PlayerBlockBoost = true;

Properties.GetContext().GameModeName.Value = "Режим: Тюрьма (Бунт)";
TeamsBalancer.IsAutoBalance = true;
Ui.GetContext().MainTimerId.Value = mainTimer.Id;

const blueTeam = teams.create_team_blue();
const redTeam = teams.create_team_red();
blueTeam.Build.BlocksSet.Value = BuildBlocksSet.Blue;
redTeam.Build.BlocksSet.Value = BuildBlocksSet.Red;

redTeam.Properties.Get("Deaths").Value = maxDeaths;
blueTeam.Properties.Get("Deaths").Value = maxDeaths;

LeaderBoard.PlayerLeaderBoardValues = [
	new DisplayValueHeader("Kills", "Statistics/Kills", "Statistics/KillsShort"),
	new DisplayValueHeader("Deaths", "Statistics/Deaths", "Statistics/DeathsShort"),
	new DisplayValueHeader("Spawns", "Statistics/Spawns", "Statistics/SpawnsShort"),
	new DisplayValueHeader("Scores", "Statistics/Scores", "Statistics/ScoresShort")
];
LeaderBoard.TeamLeaderBoardValue = new DisplayValueHeader("Deaths", "Statistics\\Deaths", "Statistics\\Deaths");

LeaderBoard.TeamWeightGetter.Set(function (team) {
	return team.Properties.Get("Deaths").Value;
});

LeaderBoard.PlayersWeightGetter.Set(function (player) {
	return player.Properties.Get("Kills").Value;
});

Ui.GetContext().TeamProp1.Value = { Team: "Blue", Prop: "Deaths" };
Ui.GetContext().TeamProp2.Value = { Team: "Red", Prop: "Deaths" };

Teams.OnRequestJoinTeam.Add(function (player, team) { team.Add(player); });
Teams.OnPlayerChangeTeam.Add(function (player) { player.Spawns.Spawn() });

Spawns.GetContext().OnSpawn.Add(function (player) {
	if (stateProp.Value == MockModeStateValue) {
		player.Properties.Immortality.Value = false;
		return;
	}
	player.Properties.Immortality.Value = true;
	player.Timers.Get(immortalityTimerName).Restart(3);
});
Timers.OnPlayerTimer.Add(function (timer) {
	if (timer.Id != immortalityTimerName) return;
	timer.Player.Properties.Immortality.Value = false;
});

Properties.OnPlayerProperty.Add(function (context, value) {
	if (value.Name !== "Deaths") return;
	if (context.Player.Team == null) return;
	context.Player.Team.Properties.Get("Deaths").Value--;
});

Properties.OnTeamProperty.Add(function (context, value) {
	if (value.Name !== "Deaths") return;
	if (value.Value <= 0) SetEndOfMatch();
});

Spawns.OnSpawn.Add(function (player) {
	if (stateProp.Value == MockModeStateValue) return;
	++player.Properties.Spawns.Value;
});

Damage.OnDeath.Add(function (player) {
	if (stateProp.Value == MockModeStateValue) {
		Spawns.GetContext(player).Spawn();
		return;
	}
	++player.Properties.Deaths.Value;
});

Damage.OnKill.Add(function (player, killed) {
	if (stateProp.Value == MockModeStateValue) return;
	if (killed.Team != null && killed.Team != player.Team) {
		++player.Properties.Kills.Value;
		player.Properties.Scores.Value += 100;
	}
});

mainTimer.OnTimer.Add(function () {
	switch (stateProp.Value) {
		case WaitingStateValue:
			SetBuildMode();
			break;
		case BuildModeStateValue:
			SetKnivesMode();
			break;
		case KnivesModeStateValue:
			SetGameMode();
			break;
		case GameStateValue:
			SetEndOfMatch();
			break;
		case MockModeStateValue:
			SetEndOfMatch_EndMode();
			break;
		case EndOfMatchStateValue:
			start_vote();
			break;
	}
});

function tryGiveRandomKnife() {
	if (Math.random() < 0.5) {
		var prisoners = redTeam.Players;
		if (prisoners.length > 0) {
			var luckyOne = prisoners[Math.floor(Math.random() * prisoners.length)];
			var pInventory = Inventory.GetContext(luckyOne);
			if (pInventory) {
				pInventory.Melee.Value = true;
			}
		}
	}
}

function SetWaitingMode() {
	stateProp.Value = WaitingStateValue;
	Ui.GetContext().Hint.Value = "Ожидание игроков...";
	Spawns.GetContext().enable = false;
	mainTimer.Restart(WaitingPlayersTime);
}

function SetBuildMode() {
	stateProp.Value = BuildModeStateValue;
	Ui.GetContext().Hint.Value = "Подготовка тюрьмы! Стройте базы.";
	var inventory = Inventory.GetContext();
	inventory.Main.Value = false;
	inventory.Secondary.Value = false;
	inventory.Melee.Value = true;
	inventory.Explosive.Value = false;
	inventory.Build.Value = true;
	Damage.GetContext().DamageOut.Value = false;

	mainTimer.Restart(BuildBaseTime);
	Spawns.GetContext().enable = true;
	SpawnTeams();
}

function SetKnivesMode() {
	stateProp.Value = KnivesModeStateValue;
	Ui.GetContext().Hint.Value = "Время прогулки! Заключенные без оружия.";
	Damage.GetContext().DamageOut.Value = true;

	var inventoryBlue = Inventory.GetContext(blueTeam);
	inventoryBlue.Main.Value = false;
	inventoryBlue.Secondary.Value = false;
	inventoryBlue.Melee.Value = true;
	inventoryBlue.Explosive.Value = false;
	inventoryBlue.Build.Value = true;

	var inventoryRed = Inventory.GetContext(redTeam);
	inventoryRed.Main.Value = false;
	inventoryRed.Secondary.Value = false;
	inventoryRed.Melee.Value = false;
	inventoryRed.Explosive.Value = false;
	inventoryRed.Build.Value = true;

	mainTimer.Restart(KnivesModeTime);
	Spawns.GetContext().enable = true;
	SpawnTeams();
	tryGiveRandomKnife();
}

function SetGameMode() {
	Damage.GetContext().DamageOut.Value = true;
	stateProp.Value = GameStateValue;
	Ui.GetContext().Hint.Value = "Склад открыт! Охрана вооружена.";

	var inventoryBlue = Inventory.GetContext(blueTeam);
	inventoryBlue.Main.Value = true;
	inventoryBlue.Secondary.Value = true;
	inventoryBlue.Melee.Value = true;
	inventoryBlue.Explosive.Value = true;
	inventoryBlue.Build.Value = true;

	var inventoryRed = Inventory.GetContext(redTeam);
	inventoryRed.Main.Value = false;
	inventoryRed.Secondary.Value = false;
	inventoryRed.Melee.Value = false;
	inventoryRed.Explosive.Value = false;
	inventoryRed.Build.Value = true;

	mainTimer.Restart(GameModeTime);
	Spawns.GetContext().Despawn();
	SpawnTeams();
	tryGiveRandomKnife();
}

function SetEndOfMatch() {
	const leaderboard = LeaderBoard.GetTeams();
	if (leaderboard && leaderboard.length >= 2 && leaderboard[0].Weight !== leaderboard[1].Weight) {
		SetEndOfMatch_MockMode(leaderboard[0].Team, leaderboard[1].Team);
	}
	else {
		SetEndOfMatch_EndMode();
	}
}

function SetEndOfMatch_MockMode(winners, loosers) {
	stateProp.Value = MockModeStateValue;

	Ui.GetContext(winners).Hint.Value = "Победа! Бунт завершен!";
	Ui.GetContext(loosers).Hint.Value = "Матч окончен. Вы проиграли.";

	Damage.GetContext().DamageOut.Value = true;
	Spawns.GetContext().RespawnTime.Value = 2;

	var inventory = Inventory.GetContext(loosers);
	inventory.Main.Value = false;
	inventory.Secondary.Value = false;
	inventory.Melee.Value = false;
	inventory.Explosive.Value = false;
	inventory.Build.Value = false;

	inventory = Inventory.GetContext(winners);
	inventory.MainInfinity.Value = true;
	inventory.SecondaryInfinity.Value = true;
	inventory.ExplosiveInfinity.Value = true;
	inventory.BuildInfinity.Value = true;

	mainTimer.Restart(MockModeTime);
}

function SetEndOfMatch_EndMode() {
	stateProp.Value = EndOfMatchStateValue;
	Ui.GetContext().Hint.Value = "Конец матча!";

	var spawns = Spawns.GetContext();
	spawns.enable = false;
	spawns.Despawn();
	Game.GameOver(LeaderBoard.GetTeams());
	mainTimer.Restart(EndOfMatchTime);
}

function OnVoteResult(v) {
	if (v.Result === null) return;
	NewGame.RestartGame(v.Result);
}
NewGameVote.OnResult.Add(OnVoteResult);

function start_vote() {
	NewGameVote.Start({
		Variants: [{ MapId: 0 }],
		Timer: VoteTime
	}, MapRotation ? 3 : 0);
}

function SpawnTeams() {
	for (const team of Teams)
		Spawns.GetContext(team).Spawn();
}

GameMode.OnStart.Add(function () {
	AreaPlayerTriggerService.GetContext().OnEnter.Add(function (player, trigger) {
		if (trigger.Tags.Contains("armory")) {
			if (player.Team && player.Team.Name === teams.RED_TEAM_NAME && !IS_RIOT) {
				IS_RIOT = true;
				Ui.GetContext().Hint.Value = "ВНИМАНИЕ: НАЧАЛСЯ БУНТ ЗАКЛЮЧЕННЫХ!";
				var pInventory = player.Inventory.Main;
				if (pInventory) {
					pInventory.Weapon1.Value = true;
					pInventory.Weapon2.Value = true;
				}
			}
		}
	});
});

SetWaitingMode();
