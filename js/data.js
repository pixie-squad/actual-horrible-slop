/*
  Demo data set. Everything here is invented sample content so the interface
  can be explored without an account. The Luau snippets call an illustrative
  API; they are not real game scripts.
*/
(function () {
  'use strict';
  const NT = window.NT;

  const SAMPLES = [
`--!strict
-- {{NAME}}
-- Sample script from the demo data set. The API shown is illustrative.

local Battle = require("@nt/battle")
local Timer = require("@nt/timer")

local GRAVITY_SCALE = 0.35
local PAD_BOOST = 2.0
local MAX_AIRTIME = 4.5

type Flyer = {
	id: number,
	airtime: number,
	boosted: boolean,
}

local flyers: { [number]: Flyer } = {}

local function track(player): Flyer
	local flyer = { id = player.id, airtime = 0, boosted = false }
	flyers[player.id] = flyer
	return flyer
end

Battle.onStart(function(ctx)
	ctx.physics:setGravityScale(GRAVITY_SCALE)
	for _, player in ctx:players() do
		track(player)
	end
	ctx:announce("Gravity at " .. GRAVITY_SCALE * 100 .. "%")
end)

Battle.onTick(function(ctx, dt: number)
	for id, flyer in flyers do
		local player = ctx:player(id)
		if player == nil then
			flyers[id] = nil
			continue
		end

		if player:isAirborne() then
			flyer.airtime += dt
			if flyer.airtime > MAX_AIRTIME then
				player:applyImpulse(0, -12)
				flyer.airtime = 0
			end
		else
			flyer.airtime = 0
			flyer.boosted = false
		end
	end
end)

Battle.onJumpPad(function(ctx, player, pad)
	local flyer = flyers[player.id] or track(player)
	if not flyer.boosted then
		flyer.boosted = true
		pad:launch(player, PAD_BOOST)
		Timer.after(0.4, function()
			player:setTrail("comet")
		end)
	end
end)
`,
`--!strict
-- {{NAME}}
-- Sample script from the demo data set. The API shown is illustrative.

local Battle = require("@nt/battle")

local STEP_SECONDS = 10
local STEP_PERCENT = 15
local SPEED_CAP = 280

local elapsed = 0
local level = 0

local function speedFor(step: number): number
	return math.min(100 + step * STEP_PERCENT, SPEED_CAP)
end

Battle.onStart(function(ctx)
	elapsed = 0
	level = 0
	ctx.rules:set("speedBuffPercent", 100)
	ctx.rules:set("disablePoisonProgression", false)
end)

Battle.onTick(function(ctx, dt: number)
	elapsed += dt
	local step = elapsed // STEP_SECONDS
	if step == level then
		return
	end

	level = step
	local speed = speedFor(level)
	ctx.rules:set("speedBuffPercent", speed)

	if speed >= SPEED_CAP then
		ctx:announce("Top speed. Good luck.")
	else
		ctx:announce("Speed " .. speed .. "%")
	end
end)

Battle.onDefeat(function(ctx, victim, attacker)
	if attacker ~= nil then
		attacker:heal(0.25)
	end
end)
`,
`--!strict
-- {{NAME}}
-- Sample script from the demo data set. The API shown is illustrative.

local Battle = require("@nt/battle")
local Timer = require("@nt/timer")

type Wave = { bots: number, difficulty: number, rest: number }

local WAVES: { Wave } = {
	{ bots = 3, difficulty = 2, rest = 6 },
	{ bots = 4, difficulty = 4, rest = 6 },
	{ bots = 5, difficulty = 6, rest = 8 },
	{ bots = 6, difficulty = 8, rest = 8 },
	{ bots = 6, difficulty = 10, rest = 0 },
}

local current = 0
local alive = 0

local function spawnWave(ctx, wave: Wave)
	alive = wave.bots
	ctx.rules:set("botsDifficulty", wave.difficulty)
	for i = 1, wave.bots do
		ctx:spawnBot({ lane = (i - 1) % 3 + 1, shield = 1.5 })
	end
	ctx:announce("Wave " .. current .. " of " .. #WAVES)
end

local function nextWave(ctx)
	current += 1
	local wave = WAVES[current]
	if wave == nil then
		ctx:finish({ winner = "players", reason = "Gauntlet cleared" })
		return
	end
	spawnWave(ctx, wave)
end

Battle.onStart(function(ctx)
	current = 0
	nextWave(ctx)
end)

Battle.onDefeat(function(ctx, victim)
	if not victim.isBot then
		return
	end

	alive -= 1
	if alive > 0 then
		return
	end

	local rest = WAVES[current].rest
	if rest > 0 then
		ctx:announce("Breather: " .. rest .. "s")
	end
	Timer.after(rest, function()
		nextWave(ctx)
	end)
end)
`,
`--!strict
-- {{NAME}}
-- Sample script from the demo data set. The API shown is illustrative.

local Battle = require("@nt/battle")

local CHARGE_EVERY = 20 -- ticks
local SHIELD_SECONDS = 3

local ticks = 0

Battle.onStart(function(ctx)
	ticks = 0
	ctx.rules:set("chargeUltiAutomatically", true)
	ctx.rules:set("automaticTicks", CHARGE_EVERY)
	ctx.rules:set("respawnShieldExpandSeconds", SHIELD_SECONDS)
	ctx:announce("Supers are free. Experiment.")
end)

Battle.onTick(function(ctx)
	ticks += 1
	if ticks % CHARGE_EVERY ~= 0 then
		return
	end

	for _, player in ctx:players() do
		if player:isAlive() then
			player:chargeSuper(1.0)
		end
	end
end)

Battle.onSuper(function(ctx, player, target)
	-- Log every activation so combos can be reviewed afterwards.
	ctx.log:write({
		who = player.name,
		at = ctx.time,
		hit = target ~= nil,
	})
end)
`,
  ];

  const DAY = 86400000;

  NT.seed = function () {
    const now = Date.now();
    const ago = (days) => new Date(now - days * DAY).toISOString();

    const users = {
      'u-demo': { user_id: 'u-demo', name: 'Demo Player', username: 'demo', has_password: true, has_connect_email: false },
      'u-ava': { user_id: 'u-ava', name: 'Ava Lindqvist', username: 'ava' },
      'u-kenji': { user_id: 'u-kenji', name: 'Kenji Mori', username: 'kenji' },
      'u-noor': { user_id: 'u-noor', name: 'Noor Haddad', username: 'noor' },
      'u-teo': { user_id: 'u-teo', name: 'Teo Marchetti', username: 'teo', no_connect: true },
      'u-zuri': { user_id: 'u-zuri', name: 'Zuri Okafor', username: 'zuri' },
    };

    const defs = [
      ['lowgrav01', 'Low Gravity Brawl', 'u-ava', 0.2, 0.2, 0, 'Everyone floats. Jump pads launch twice as far and projectiles arc slowly, so dodging turns into a game of patience.', ['Tuned pad boost after feedback.', 'Airtime cap so nobody drifts forever.', 'First public release.']],
      ['sprint02', 'Sudden Death Sprint', 'u-kenji', 1.4, 1.4, 1, 'Movement speed climbs every ten seconds while the poison closes in early. Matches rarely last longer than a minute.', ['Speed now caps at 280%.', 'First public release.']],
      ['superlab03', 'Infinite Super Lab', 'u-noor', 3, 3, 3, 'Supers recharge on a timer for both teams. Built for practising combos and testing interactions without waiting around.', ['Added activation log.', 'First public release.']],
      ['glass04', 'Glass Cannon', 'u-teo', 5, 5, 1, 'Everyone hits three times as hard but starts with a third of their health. One clean shot usually decides the fight.', ['First public release.']],
      ['pets05', 'Pet Parade', 'u-zuri', 6.5, 6.5, 0, 'Spawns extra companions for every player and scales them with the battle level. Chaos, but friendly chaos.', ['Companions follow more closely.', 'First public release.']],
      ['turtle06', 'Turtle Mode', 'u-ava', 9, 9, 3, 'Slow reloads, thick shields and long respawn protection. A deliberately defensive ruleset for map control drills.', ['First public release.']],
      ['gauntlet07', 'Bot Gauntlet', 'u-kenji', 12, 12, 2, 'Five waves of increasingly sharp bots with a short breather between rounds. See how far your trio can get.', ['Wave five is now properly unfair.', 'Rest timer between waves.', 'First public release.']],
      ['nogadget08', 'Back to Basics', 'u-noor', 16, 16, 1, 'No gadgets, no star powers, no hypercharges. Just movement, aim and whatever the map gives you.', ['First public release.']],
      ['park09', 'Poison Free Park', 'u-zuri', 24, 24, 0, 'Turns the poison off entirely and keeps chat open during the battle. Made for hanging out and trying silly ideas.', ['First public release.']],
      ['retro10', 'Level One Legends', 'u-teo', 75, 75, 2, 'Drops every upgrade level to one so matches play like a fresh account. Surprisingly tense in the late game.', ['First public release.']],
      ['trainer11', 'Speedrun Trainer', 'u-demo', 0.6, 2, 1, 'Tight respawn timers and a split clock for routing practice. Resets the round whenever anyone leaves the lane.', ['Split clock survives respawns.', 'First public release.']],
      ['sandbox12', 'Chill Sandbox', 'u-demo', 72, 72, 3, 'A calm ruleset with generous shields and automatic charges, kept around from before the scripting API changed.', ['First public release.']],
      ['hyper13', 'Hypercharge Party', 'u-demo', 0.05, null, 3, '', []],
      ['draft14', 'New Script 4', 'u-demo', 4, null, 0, '', []],
    ];

    const scripts = {};
    const releases = {};
    for (const [id, name, author, updated, published, sample, description, notes] of defs) {
      scripts[id] = {
        script_id: id,
        name,
        description: description || null,
        author_uuid: author,
        updated_at: ago(updated),
        published_at: published == null ? null : ago(published),
        user_map_id: id === 'trainer11' ? 'm-1' : null,
        content: id === 'draft14' ? '' : SAMPLES[sample].replace('{{NAME}}', name),
        revision: Math.max(1, notes.length),
      };
      releases[id] = notes.map((text, i) => ({
        revision: notes.length - i,
        created_at: ago(published + i * 6 + (i ? 1.5 : 0)),
        description: text,
      }));
    }

    return {
      version: 3,
      me: 'u-demo',
      signedIn: true,
      users,
      scripts,
      releases,
      favorites: { 'u-demo': ['lowgrav01', 'gauntlet07', 'superlab03'] },
      maps: [
        { user_map_id: 'm-1', name: 'Canyon Loop', internal_id: '7Kq2mXw9:3', owner: 'u-demo' },
        { user_map_id: 'm-2', name: 'Twin Rivers', internal_id: 'Rt81bVzP:1', owner: 'u-demo' },
      ],
      audit: [
        { occurred_at: ago(0.05), actor_id: 'u-demo', target_id: 'hyper13', event_type: 'ScriptUpdate', changes: { content: true }, metadata: {} },
        { occurred_at: ago(0.6), actor_id: 'u-demo', target_id: 'trainer11', event_type: 'ScriptUpdate', changes: { content: true }, metadata: {} },
        { occurred_at: ago(2), actor_id: 'u-demo', target_id: 'trainer11', event_type: 'ScriptPublish', changes: { revision: 2 }, metadata: {} },
        { occurred_at: ago(4), actor_id: 'u-demo', target_id: 'draft14', event_type: 'ScriptCreate', changes: {}, metadata: {} },
        { occurred_at: ago(9.5), actor_id: 'u-demo', target_id: 'trainer11', event_type: 'ScriptPublish', changes: { revision: 1 }, metadata: {} },
        { occurred_at: ago(72), actor_id: 'u-demo', target_id: 'sandbox12', event_type: 'ScriptPublish', changes: { revision: 1 }, metadata: {} },
        { occurred_at: ago(80), actor_id: 'u-demo', target_id: 'u-demo', event_type: 'UserRegister', changes: {}, metadata: {} },
      ],
    };
  };

  // Battle parameters offered on every script page (same shape the live API returns).
  const G = {
    levels: '6256599c-a4d8-400f-a615-6d2ec4848335',
    buffs: 'eb4afba2-b363-451e-b1bf-4c5b6832f6e3',
    charges: '57878b05-1b9b-4ade-84ce-17e492d8abeb',
    other: '9900c3ae-e526-4080-887b-b3b3427d3051',
    flags: 'f93d2b68-f4d9-44b1-8176-f8f520a68da7',
    abilities: '98e6016e-7189-4fbf-bccc-7c9bc5833ddb',
    drops: 'b964b647-1834-4414-b4a3-e86b0a3c58f6',
  };
  const int = (name, group, def, min, max) => ({ id: 'p-' + name, name, group_id: group, type: 'int', default_value: def, min_value: min, max_value: max });
  const bool = (name, group, def) => ({ id: 'p-' + name, name, group_id: group, type: 'bool', default_value: def, min_value: 0, max_value: 1 });

  NT.demoParameters = [
    int('levelHitPoints', G.levels, 11, 1, 11),
    int('levelSkillWeapon', G.levels, 11, 1, 11),
    int('levelSkillUlti', G.levels, 11, 1, 11),
    int('levelServer', G.levels, 11, 1, 11),
    int('speedBuffPercent', G.buffs, 100, 0, 300),
    int('reloadBuffPercent', G.buffs, 100, 0, 300),
    int('chargeUltiPercent', G.buffs, 100, 0, 300),
    int('accessoryCooldownSubtractPercent', G.buffs, 0, 0, 100),
    int('poisonDamagePercent', G.buffs, 100, 0, 300),
    int('regenerationHeroPercent', G.buffs, 100, 0, 300),
    bool('chargeUltiAutomatically', G.charges, 0),
    bool('chargeOverchargeAutomatically', G.charges, 0),
    int('automaticTicks', G.charges, 20, 1, 60),
    int('additionalPetsCount', G.other, 0, 0, 3),
    int('botsDifficulty', G.other, 5, 0, 10),
    int('respawnShieldExpandSeconds', G.other, 3, 0, 10),
    int('gearsAmount', G.other, 2, 0, 2),
    bool('disablePoison', G.flags, 0),
    bool('disablePoisonProgression', G.flags, 0),
    bool('restrictTeamJoin', G.flags, 0),
    bool('viewSelection', G.flags, 0),
    bool('allowSelfKill', G.flags, 1),
    bool('enableChat', G.flags, 1),
    bool('hasGadgets', G.abilities, 1),
    bool('hasStarPowers', G.abilities, 1),
    bool('hasOvercharges', G.abilities, 1),
    bool('hasBuddyGadgets', G.abilities, 1),
    bool('hasBuddyStarPowers', G.abilities, 1),
    bool('hasBuddyOvercharges', G.abilities, 1),
    bool('boxPowerPoints', G.drops, 1),
    bool('characterPowerPointsRate', G.drops, 1),
  ];
})();
