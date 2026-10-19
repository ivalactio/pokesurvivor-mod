// ==UserScript==
// @name         PokéSurvivor - Minimapa HUD Integrado + Historial Nativo (v3.9.3)
// @namespace    local.pokesurvivor.minimap.passive
// @version      3.9.3
// @description  Minimapa HUD abajo a la derecha y Panel de Daño independiente arriba a la izquierda, Editor UI Barra de Vida y Bufos, Colapso de Leyenda, FOV Zoom, Turbo Gacha + Tirar Todo e Historial.
// @match        https://pokesurvivor.com/*
// @match        https://www.pokesurvivor.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const TURBO_GACHA_KEY = 'psm-turbo-gacha';
  const FOV_STORAGE_KEY = 'psm-fov-zoom-v1';
  const SHOW_BUFFS_KEY = 'psm-show-buffs-v1';
  const SHOW_MOVES_KEY = 'psm-show-moves-v1';
  const HP_CONFIG_KEY = 'psm_custom_hp_config_v1';
  const HP_CONFIG_FALLBACK_KEY = 'psm-hp-bar-config-v2';
  const BUFFS_CONFIG_KEY = 'psm_custom_buffs_config_v1';
  const MAP_DETAILS_KEY = 'psm-map-details-v1';
  const MIN_FOV = 0.35;
  const MAX_FOV = 2.5;

  let showMapDetails = true;
  try {
    showMapDetails = localStorage.getItem(MAP_DETAILS_KEY) !== 'false';
  } catch (_) {}

  const DEFAULT_HP_CONFIG = {
    x: 18,
    y: 18,
    scale: 1.0,
    orientation: 'horizontal',
    theme: 'classic'
  };

  let hpBarConfig = { ...DEFAULT_HP_CONFIG };
  try {
    let rawHp = localStorage.getItem(HP_CONFIG_KEY);
    if (!rawHp) rawHp = localStorage.getItem(HP_CONFIG_FALLBACK_KEY);
    if (rawHp) {
      const savedHp = JSON.parse(rawHp);
      if (typeof savedHp.x === 'number') hpBarConfig.x = savedHp.x;
      if (typeof savedHp.y === 'number') hpBarConfig.y = savedHp.y;
      if (typeof savedHp.scale === 'number') hpBarConfig.scale = Math.max(0.6, Math.min(2.5, savedHp.scale));
      if (savedHp.orientation === 'vertical' || savedHp.orientation === 'horizontal') {
        hpBarConfig.orientation = savedHp.orientation;
      }
      if (savedHp.theme === 'classic' || savedHp.theme === 'minimal') {
        hpBarConfig.theme = savedHp.theme;
      }
    }
  } catch (_) {}

  const DEFAULT_BUFFS_CONFIG = {
    x: 18,
    y: 78,
    scale: 1.0
  };

  let buffsBarConfig = { ...DEFAULT_BUFFS_CONFIG };
  try {
    const rawBuffs = localStorage.getItem(BUFFS_CONFIG_KEY);
    if (rawBuffs) {
      const savedBuffs = JSON.parse(rawBuffs);
      if (typeof savedBuffs.x === 'number') buffsBarConfig.x = savedBuffs.x;
      if (typeof savedBuffs.y === 'number') buffsBarConfig.y = savedBuffs.y;
      if (typeof savedBuffs.scale === 'number') {
        buffsBarConfig.scale = Math.max(0.6, Math.min(2.5, savedBuffs.scale));
      }
    }
  } catch (_) {}

  let isEditingUI = false;

  let fovZoom = 1.0;
  try {
    const savedFov = parseFloat(localStorage.getItem(FOV_STORAGE_KEY));
    if (Number.isFinite(savedFov) && savedFov >= MIN_FOV && savedFov <= MAX_FOV) {
      fovZoom = savedFov;
    }
  } catch (_) {}

  let turboGachaEnabled = false;
  try {
    turboGachaEnabled = localStorage.getItem(TURBO_GACHA_KEY) === 'true';
  } catch (_) {}

  let showBuffsPanel = false;
  try {
    showBuffsPanel = localStorage.getItem(SHOW_BUFFS_KEY) === 'true';
  } catch (_) {}

  let showOwnMovesInRow = true;
  try {
    const savedMovesVis = localStorage.getItem(SHOW_MOVES_KEY);
    if (savedMovesVis !== null) showOwnMovesInRow = savedMovesVis === 'true';
  } catch (_) {}

  if (document.documentElement) {
    document.documentElement.classList.toggle('psm-turbo-gacha-on', turboGachaEnabled);
  }

  // ------------------------------------------------------------------
  // CAPTURA DE NAMESPACE INTERNO (NS) EN DOCUMENT_START (ENFOQUE POKESURVIVOR-MOD v1.4.0)
  // Permite escalar Camera, Gacha Pull-All, Co-op Net sync, Rift timers, EnemyMgr y Move Damage
  // ------------------------------------------------------------------
  let gameNS = window.__psmodNS || window.__psmGameNS || window.__psmNS || null;
  let engineCam = null;
  let baseCamW = 768;
  let baseCamH = 420;
  let lastResizeArgs = null;
  let gachaEngineHooked = false;
  let coopMeterHooked = false;
  let moveTrackingHooked = false;
  let riftTrackingHooked = false;

  // Estado Gacha Pull-All
  let pullAllArmed = false;
  let forceSkipSlot = false;
  let revealBudget = null;

  // Estado Co-op Damage Meter y Reloj de Partida
  const coopDamageRows = new Map(); // uid -> { dmg, est, live }
  let engineRunPlayer = null;
  let engineRunTime = 0;
  let lastClockTickAt = 0;

  // Estado de Grietas (Rift) y Ritmo de XP
  const RIFT_EVERY = 30;
  const RIFT_FROM = 75;
  const RIFT_CUTOFF = 120;
  let riftState = { timer: RIFT_EVERY, fails: 0, open: false };
  let xpHist = [];
  let xpLast = null;
  let xpPrevLv = 1;
  let xpPrevVal = 0;

  // Estado de Daño exacto por Movimiento (Combat / Projectiles / Enemy.hurt)
  const engineMoveDmg = new Map(); // move.id | 'burn' | 'poison' | 'other' -> damage
  let combatScope = null;
  let curCastMove = null;
  let curResolvedProj = null;
  const BURN_COL = '#ff9a4d';
  const POISON_COL = '#d47cf0';
  const FIELD_KINDS = ['mine', 'trail', 'meteor', 'turret'];

  function waitForEngine(pred, cb) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      try {
        if (pred()) {
          clearInterval(iv);
          cb();
          return;
        }
      } catch (_) {}
      if (tries > 600) {
        clearInterval(iv);
      }
    }, 60);
  }

  function getEngineLocalPlayer() {
    if (!gameNS) return null;
    if (gameNS.Coop && gameNS.Coop.active && gameNS.Coop.local) return gameNS.Coop.local;
    if (gameNS.Game && gameNS.Game.player) return gameNS.Game.player;
    return null;
  }

  function getEngineMyDamage() {
    const p = getEngineLocalPlayer();
    return (p && typeof p.dmgDealt === 'number') ? p.dmgDealt : 0;
  }

  function getEngineRunSeconds() {
    if (gameNS && gameNS.Game && typeof gameNS.Game.time === 'number' && gameNS.Game.time > 0) {
      engineRunTime = gameNS.Game.time;
      return engineRunTime;
    }
    return engineRunTime > 0 ? engineRunTime : 0;
  }

  function getCoopRow(uid) {
    let r = coopDamageRows.get(uid);
    if (!r) {
      r = { dmg: 0, est: 0, live: false };
      coopDamageRows.set(uid, r);
    }
    return r;
  }

  function buildCoopWireTable() {
    if (!gameNS || !gameNS.Net) return {};
    const t = { [gameNS.Net.uid]: [Math.round(getEngineMyDamage()), 1] };
    for (const [uid, r] of coopDamageRows) {
      if (uid !== gameNS.Net.uid) {
        t[uid] = [Math.round(r.live ? r.dmg : r.est), r.live ? 1 : 0];
      }
    }
    return t;
  }

  function syncEngineCameraFov() {
    if (!engineCam) return false;
    engineCam.VIEW_W = baseCamW / fovZoom;
    engineCam.MIN_VIEW_H = baseCamH / fovZoom;
    const args = lastResizeArgs || [
      window.innerWidth || 1280,
      window.innerHeight || 720,
      Math.min(1.5, window.devicePixelRatio || 1)
    ];
    if (typeof engineCam.resize === 'function') {
      engineCam.resize.apply(engineCam, args);
    }
    return true;
  }

  function setupEngineFov(cam) {
    if (!cam || engineCam) return;
    engineCam = cam;
    baseCamW = cam.VIEW_W || 768;
    baseCamH = cam.MIN_VIEW_H || 420;
    const origResize = cam.resize;
    if (typeof origResize === 'function') {
      cam.resize = function(w, h, dpr) {
        lastResizeArgs = [w, h, dpr];
        cam.VIEW_W = baseCamW / fovZoom;
        cam.MIN_VIEW_H = baseCamH / fovZoom;
        return origResize.apply(this, arguments);
      };
    }
    syncEngineCameraFov();
  }

  function pullsAvailableCount() {
    const t = (gameNS && gameNS.DB && gameNS.DB.save && gameNS.DB.save.tickets) || {};
    return (t.t1 || 0) + 10 * (t.t10 || 0);
  }

  function setupEngineGacha() {
    if (gachaEngineHooked || !gameNS || !gameNS.Slots || !gameNS.Gacha) return;
    gachaEngineHooked = true;
    const { Slots, Gacha, Audio } = gameNS;

    if (typeof Gacha.pull === 'function' && !Gacha.pull.__psmWrapped) {
      const origPull = Gacha.pull;
      const wrappedPull = function(save, n, gen, kind) {
        if (!pullAllArmed) return origPull.apply(this, arguments);
        pullAllArmed = false;
        const t = (save && save.tickets) || {};
        const out = [];
        let safety = 0;
        const take = (count, k) => {
          if (++safety > 500) return false;
          const prev10 = t.t10 || 0;
          const prev1 = t.t1 || 0;
          const r = origPull.call(this, save, count, gen, k);
          if (!r || ((t.t10 || 0) === prev10 && (t.t1 || 0) === prev1)) return false;
          out.push(...r);
          return true;
        };
        while ((t.t10 || 0) >= 1 && take(10, 't10'));
        while ((t.t1 || 0) >= 10 && take(10, 't1'));
        while ((t.t1 || 0) >= 1 && take(1, 't1'));
        return out.length ? out : null;
      };
      wrappedPull.__psmWrapped = true;
      Gacha.pull = wrappedPull;
    }

    if (typeof Slots.play === 'function' && !Slots.play.__psmWrapped) {
      const origPlay = Slots.play;
      const wrappedPlay = function(canvas, results) {
        if (turboGachaEnabled || forceSkipSlot) {
          forceSkipSlot = false;
          return Promise.resolve();
        }
        return origPlay.apply(this, arguments);
      };
      wrappedPlay.__psmWrapped = true;
      Slots.play = wrappedPlay;
    }

    if (Audio && typeof Audio.sfx === 'function' && !Audio.sfx.__psmWrapped) {
      const origSfx = Audio.sfx;
      let lastRevealSfxAt = 0;
      const wrappedSfx = function(name) {
        if (name === 'reveal') {
          if (revealBudget !== null && revealBudget-- <= 0) return;
          if (turboGachaEnabled) {
            const now = Date.now();
            if (now - lastRevealSfxAt < 65) return;
            lastRevealSfxAt = now;
          }
        }
        return origSfx.apply(this, arguments);
      };
      wrappedSfx.__psmWrapped = true;
      Audio.sfx = wrappedSfx;
    }
  }

  function setupEngineCoopMeter() {
    if (coopMeterHooked || !gameNS || !gameNS.Net || !gameNS.Coop) return;
    coopMeterHooked = true;
    const { Net, Coop } = gameNS;

    if (typeof Net.toHost === 'function' && !Net.toHost.__psmWrapped) {
      const origToHost = Net.toHost;
      const wrappedToHost = function(m) {
        if (m && m.k === 'f' && m.psm === undefined) {
          m.psm = Math.round(getEngineMyDamage());
        }
        return origToHost.apply(this, arguments);
      };
      wrappedToHost.__psmWrapped = true;
      Net.toHost = wrappedToHost;
    }

    if (typeof Net.send === 'function' && !Net.send.__psmWrapped) {
      const origSend = Net.send;
      const wrappedSend = function(uid, m) {
        if (m && m.k === 'f' && Coop.isHost && m.psm === undefined) {
          m.psm = buildCoopWireTable();
        }
        return origSend.apply(this, arguments);
      };
      wrappedSend.__psmWrapped = true;
      Net.send = wrappedSend;
    }

    if (typeof Net.on === 'function') {
      Net.on((from, m) => {
        if (!m || m.k !== 'f' || !Coop.active) return;
        if (Coop.isHost) {
          const r = getCoopRow(from);
          if (typeof m.psm === 'number') {
            r.dmg = m.psm;
            r.live = true;
          }
          if (Array.isArray(m.ev)) {
            for (const e of m.ev) {
              if (e && e[0] === 'h') r.est += +e[2] || 0;
            }
          }
        } else if (from === Net.hostUid && m.psm && typeof m.psm === 'object') {
          for (const uid in m.psm) {
            if (uid === Net.uid || !Array.isArray(m.psm[uid])) continue;
            const r = getCoopRow(uid);
            r.dmg = +m.psm[uid][0] || 0;
            r.live = !!m.psm[uid][1];
          }
        }
      });
    }
  }

  function creditEngineMove(key, amount) {
    engineMoveDmg.set(key, (engineMoveDmg.get(key) || 0) + amount);
  }

  function matchMoveByColor(color, kinds) {
    const p = getEngineLocalPlayer();
    const C = gameNS && gameNS.U && gameNS.U.TYPE_COLOR;
    if (!p || !Array.isArray(p.moves) || !C) return 'other';
    const hits = p.moves.filter(m => C[m.type] === color && (!kinds || kinds.includes(m.kind)));
    return hits.length ? hits[0].id : 'other';
  }

  function setupEngineMoveTracking() {
    if (moveTrackingHooked || !gameNS || !gameNS.Combat || !gameNS.Projectiles || !gameNS.Enemy || !gameNS.Player || !gameNS.EnemyMgr) return;
    moveTrackingHooked = true;
    const { Combat, Projectiles, Enemy, Player, EnemyMgr } = gameNS;

    const wrapAround = (obj, name, enter, leave) => {
      const origFn = obj[name];
      if (typeof origFn !== 'function' || origFn.__psmMoveWrapped) return;
      const wrapped = function() {
        enter.apply(this, arguments);
        try {
          return origFn.apply(this, arguments);
        } finally {
          leave();
        }
      };
      wrapped.__psmMoveWrapped = true;
      obj[name] = wrapped;
    };

    wrapAround(Combat, 'tick', (dt, pl) => {
      combatScope = (pl && pl === getEngineLocalPlayer()) ? 'tick' : null;
      curCastMove = null;
    }, () => {
      combatScope = null;
      curCastMove = null;
    });

    wrapAround(Combat, 'resolve', () => {
      combatScope = 'resolve';
      curResolvedProj = null;
    }, () => {
      combatScope = null;
      curResolvedProj = null;
    });

    wrapAround(Combat, 'updateFields', () => {
      combatScope = 'fields';
    }, () => {
      combatScope = null;
    });

    wrapAround(EnemyMgr, 'update', () => {
      combatScope = 'dot';
    }, () => {
      combatScope = null;
    });

    if (Player.prototype && typeof Player.prototype.cast === 'function' && !Player.prototype.cast.__psmMoveWrapped) {
      const origCast = Player.prototype.cast;
      const wrappedCast = function(m) {
        if (combatScope === 'tick' && this === getEngineLocalPlayer()) {
          curCastMove = m;
        }
        return origCast.apply(this, arguments);
      };
      wrappedCast.__psmMoveWrapped = true;
      Player.prototype.cast = wrappedCast;
    }

    if (typeof Projectiles.spawn === 'function' && !Projectiles.spawn.__psmMoveWrapped) {
      const origSpawn = Projectiles.spawn;
      const wrappedSpawn = function(o) {
        const mid = combatScope === 'tick' && curCastMove
          ? curCastMove.id
          : (combatScope === 'fields' && o ? matchMoveByColor(o.color, ['turret']) : null);
        if (mid && o) o.__psmMid = mid;
        const out = origSpawn.apply(this, arguments);
        if (mid && out && typeof out === 'object') out.__psmMid = mid;
        return out;
      };
      wrappedSpawn.__psmMoveWrapped = true;
      Projectiles.spawn = wrappedSpawn;
    }

    if (typeof Projectiles.all === 'function' && !Projectiles.all.__psmMoveWrapped) {
      const origAll = Projectiles.all;
      const wrappedAll = function() {
        const arr = origAll.apply(this, arguments);
        if (combatScope !== 'resolve' || !Array.isArray(arr)) return arr;
        return new Proxy(arr, {
          get(t, k) {
            if (typeof k === 'string' && /^\d+$/.test(k)) {
              const v = t[k];
              if (v && typeof v === 'object') curResolvedProj = v;
              return v;
            }
            const v = Reflect.get(t, k);
            return typeof v === 'function' ? v.bind(t) : v;
          }
        });
      };
      wrappedAll.__psmMoveWrapped = true;
      Projectiles.all = wrappedAll;
    }

    if (Enemy.prototype && typeof Enemy.prototype.hurt === 'function' && !Enemy.prototype.hurt.__psmMoveWrapped) {
      const origHurt = Enemy.prototype.hurt;
      const wrappedHurt = function(dmg, color) {
        if (combatScope && !this.dead) {
          const n = Math.max(1, Math.round(+dmg || 0));
          if (combatScope === 'tick') {
            creditEngineMove(curCastMove ? curCastMove.id : matchMoveByColor(color), n);
          } else if (combatScope === 'resolve') {
            const pr = curResolvedProj;
            creditEngineMove((pr && (pr.__psmMid || pr.__mid || (pr.orb && pr.mid))) || matchMoveByColor(color), n);
          } else if (combatScope === 'fields') {
            creditEngineMove(matchMoveByColor(color, FIELD_KINDS), n);
          } else if (combatScope === 'dot' && !(gameNS.Coop && gameNS.Coop.active)) {
            if (color === BURN_COL) creditEngineMove('burn', n);
            else if (color === POISON_COL) creditEngineMove('poison', n);
          }
        }
        return origHurt.apply(this, arguments);
      };
      wrappedHurt.__psmMoveWrapped = true;
      Enemy.prototype.hurt = wrappedHurt;
    }
  }

  function riftWindowEnd() {
    return ((gameNS && gameNS.Judgment && gameNS.Judgment.AT) || 1800) - RIFT_CUTOFF;
  }

  function setupEngineRiftTracking() {
    if (riftTrackingHooked || !gameNS || !gameNS.Rift || typeof gameNS.Rift.update !== 'function') return;
    riftTrackingHooked = true;
    const R = gameNS.Rift;

    if (typeof R.reset === 'function' && !R.reset.__psmWrapped) {
      const origReset = R.reset;
      const wrappedReset = function() {
        riftState = { timer: RIFT_EVERY, fails: 0, open: false };
        return origReset.apply(this, arguments);
      };
      wrappedReset.__psmWrapped = true;
      R.reset = wrappedReset;
    }

    if (!R.update.__psmWrapped) {
      const origUpdate = R.update;
      const wrappedUpdate = function(dt, pl, time) {
        if (typeof time === 'number' && time >= 0) {
          engineRunTime = time;
        }
        if (R.rift && !riftState.open) {
          riftState.fails = 0;
          riftState.timer = RIFT_EVERY;
        }
        let rolled = false;
        if (!R.rift && !R.arena && time > RIFT_FROM && time < riftWindowEnd()) {
          riftState.timer -= +dt || 0;
          if (riftState.timer <= 0) {
            riftState.timer = RIFT_EVERY;
            rolled = !(gameNS.EnemyMgr && gameNS.EnemyMgr.bossAlive && gameNS.EnemyMgr.bossAlive());
          }
        }
        const out = origUpdate.apply(this, arguments);
        if (R.rift && !riftState.open) {
          riftState.fails = 0;
          riftState.timer = RIFT_EVERY;
        } else if (rolled && !R.rift) {
          riftState.fails = Math.min(4, riftState.fails + 1);
        }
        riftState.open = !!R.rift;
        return out;
      };
      wrappedUpdate.__psmWrapped = true;
      R.update = wrappedUpdate;
    }
  }

  function attachAllEngineHooks() {
    if (!gameNS) return;
    window.__psmNS = gameNS;
    window.__psmGameNS = gameNS;
    if (!window.__psmodNS) window.__psmodNS = gameNS;
    if (gameNS.Camera) setupEngineFov(gameNS.Camera);
    waitForEngine(() => gameNS.Slots && gameNS.Gacha, setupEngineGacha);
    waitForEngine(() => gameNS.Net && gameNS.Coop && gameNS.Game, setupEngineCoopMeter);
    waitForEngine(() => gameNS.Combat && gameNS.Projectiles && gameNS.Enemy && gameNS.Player && gameNS.EnemyMgr, setupEngineMoveTracking);
    waitForEngine(() => gameNS.Rift && gameNS.Rift.update && gameNS.EnemyMgr, setupEngineRiftTracking);
  }

  if (gameNS && gameNS.Camera) {
    attachAllEngineHooks();
  } else {
    try {
      const existingDesc = Object.getOwnPropertyDescriptor(Object.prototype, 'Camera');
      if (!existingDesc) {
        Object.defineProperty(Object.prototype, 'Camera', {
          configurable: true,
          get() { return undefined; },
          set(v) {
            // Eliminar siempre primero el interceptor de Object.prototype (igual que pokesurvivor-mod v1.4.0)
            delete Object.prototype.Camera;
            try {
              this.Camera = v;
            } catch (_) {
              Object.defineProperty(this, 'Camera', {
                value: v,
                writable: true,
                configurable: true,
                enumerable: true
              });
            }
            if (this && typeof this === 'object') {
              gameNS = this;
              attachAllEngineHooks();
            }
          }
        });
      }
    } catch (_) {}
  }

  function bootWhenReady() {
    if (document.getElementById('psm-map-panel') || document.getElementById('psm-stats-panel')) return;
    const gameCanvas = document.getElementById('game');
    if (!gameCanvas || !document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootWhenReady, { once: true });
      } else {
        setTimeout(bootWhenReady, 80);
      }
      return;
    }
    initExtension(gameCanvas);
  }

  bootWhenReady();

  function initExtension(gameCanvas) {
    if (document.getElementById('psm-map-panel') || document.getElementById('psm-stats-panel')) return;

    const gameCtx = gameCanvas.getContext('2d');
    if (!gameCtx) return;

    document.documentElement.classList.toggle('psm-turbo-gacha-on', turboGachaEnabled);

    const SIZE = 256;
    const DEFAULT_PANEL_W = 264;
    const DEFAULT_CONTENT_H = 244;
    const CHUNK = 512;
    const STORAGE_KEY = 'psm-passive-filters-v1';
    const HISTORY_KEY = 'psm-run-history-v1';
    const SIZE_KEY = 'psm-panel-size-v1';
    const STARTERS_KEY = 'psm-starter-moves-v1';
    const MAX_HISTORY_RUNS = 40;
    const MIN_MAP_RADIUS = 450;
    const MAX_MAP_RADIUS = 3000; // Limita el zoom out mínimo del minimapa a 0.6× (1800 / 3000)

    let radiusWorld = 1800;
    let centerWorld = null;
    let viewCorners = [];
    let viewBounds = null;
    let activeRun = false;
    let hiddenByUser = false;
    let mapCollapsed = false;
    let statsCollapsed = false;
    let mapHasCustomPosition = false;
    let statsHasCustomPosition = false;
    let lastTrailAt = 0;
    let frameId = 0;
    let runStartedAt = 0;
    let runSavedForCurrentSession = false;
    let lastRenderedBuildSig = '';

    const origSetTimeout = window.setTimeout.bind(window);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Dimensiones personalizables del HUD in-game
  let panelWidth = DEFAULT_PANEL_W;
  let contentHeight = DEFAULT_CONTENT_H;
  try {
    const savedSize = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}');
    if (Number.isFinite(savedSize.w) && savedSize.w >= 220 && savedSize.w <= 750) {
      panelWidth = savedSize.w;
    }
    if (Number.isFinite(savedSize.h) && savedSize.h >= 170 && savedSize.h <= 750) {
      contentHeight = savedSize.h;
    }
  } catch (_) {}

  // Caché de ataques iniciales por Pokémon
  let starterMovesByPoke = {};
  try {
    starterMovesByPoke = JSON.parse(localStorage.getItem(STARTERS_KEY) || '{}') || {};
  } catch (_) {}

  function saveStarterMovesForPoke(pokeName, moveNames) {
    if (!pokeName || !Array.isArray(moveNames) || moveNames.length === 0) return;
    const key = pokeName.toLowerCase();
    starterMovesByPoke[key] = moveNames.slice(0, 2);
    try {
      localStorage.setItem(STARTERS_KEY, JSON.stringify(starterMovesByPoke));
    } catch (_) {}
  }

  let panOffset = { x: 0, y: 0 };
  let isPanningMap = false;

  const CATEGORIES = [
    { id: 'player',   label: 'Tú',             color: '#70dfff' },
    { id: 'ally',     label: 'Aliados',        color: '#5fe08a' },
    { id: 'pokemon',  label: 'Pokémon',        color: '#ff6675' },
    { id: 'object',   label: 'Objetos',        color: '#f4b942' },
    { id: 'chest',    label: 'Cofres',         color: '#fff0a0' },
    { id: 'bigchest', label: 'Cofre G.',       color: '#ff62bd' },
    { id: 'altar',    label: 'Altares',        color: '#bd8aff' },
    { id: 'spring',   label: 'Manantial',      color: '#42e5d2' },
    { id: 'trap',     label: 'Trampas',        color: '#a6ee55' },
    { id: 'boss',     label: 'Jefes',          color: '#ff9f43', isBoss: true }
  ];

  const visibility = Object.fromEntries(CATEGORIES.map(c => [c.id, true]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const c of CATEGORIES) {
      if (typeof saved[c.id] === 'boolean') visibility[c.id] = saved[c.id];
    }
  } catch (_) {}

  const NON_DAMAGING_MOVES = new Set([
    'sustituto',
    'danza espada',
    'paz mental',
    'corpulencia',
    'agilidad',
    'defensa férrea', 'defensa ferrea',
    'amnesia',
    'protección', 'proteccion',
    'descanso',
    'recuperación', 'recuperacion',
    'sol matinal',
    'luz lunar',
    'respiro',
    'viento afín', 'viento afin',
    'reflejo',
    'pantalla de luz',
    'danza dragón', 'danza dragon',
    'maldición', 'maldicion'
  ]);

  const KNOWN_PASSIVES = new Set([
    'síntesis', 'sintesis',
    'coraza',
    'reflejos',
    'imán', 'iman',
    'potencia',
    'vigor',
    'velocidad', 'agilidad', 'prisa',
    'alcance', 'área', 'area',
    'fortuna', 'suerte',
    'sabiduría', 'sabiduria', 'experiencia',
    'crítico', 'critico', 'precisión', 'precision',
    'armadura', 'defensa', 'resistencia',
    'regeneración', 'regeneracion',
    'codicia', 'impulso', 'empuje', 'duración', 'duracion'
  ]);

  const IGNORED_HUD_TEXTS = new Set([
    'pokésurvivor', 'mundo misterioso', 'pausa', 'nivel', 'nv', 'lv', 'lvl',
    'xp', 'exp', 'hp', 'ps', 'fps', 'ms', 'ping', 'kills', 'derrotados',
    'jefes', 'boss', 'tiempo', 'monedas', 'oro', 'wasd', 'esc', 'espacio',
    'space', 'shift', 'tab', 'enter', 'normal', 'shiny', 'nuevo', 'mejora',
    'vínculo', 'vinculo', 'objeto', 'fuego', 'agua', 'planta', 'eléctrico',
    'electrico', 'psíquico', 'psiquico', 'hielo', 'dragón', 'dragon',
    'siniestro', 'hada', 'lucha', 'volador', 'veneno', 'tierra', 'roca',
    'bicho', 'fantasma', 'acero'
  ]);

  function sanitizeMoveTitle(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/^\s*\[?[1234qe]\]?\s*[:·-]?\s*/i, '')
      .replace(/\s*(?:·\s*)?(?:Nuevo|Mejora|Nv\.?\s*\d+|Nivel\s*\d+|Lv\.?\s*\d+).*$/i, '')
      .replace(/^[·\s-]+|[·\s-]+$/g, '')
      .trim();
  }

  let runHistory = [];
  function saveHistoryToStorage() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(runHistory.slice(0, MAX_HISTORY_RUNS)));
    } catch (_) {}
  }

  function sanitizeExistingHistory(rawList) {
    if (!Array.isArray(rawList)) return [];
    const cleaned = [];

    for (const r of rawList) {
      if (!r || typeof r !== 'object') continue;
      if ((r.timeSec || 0) < 10 && (r.maxDps || 0) === 0 && (r.kills || 0) === 0 && (r.totalDamage || 0) === 0) {
        continue;
      }

      if (Array.isArray(r.moves) && r.moves.length > 0) {
        let orphanDamage = 0;
        let orphanMaxLv = 1;
        const validMoves = [];

        for (const m of r.moves) {
          const cleanT = sanitizeMoveTitle(m.title);
          if (!cleanT || /^[1234]$/.test(cleanT) || cleanT.toLowerCase() === 'ataque inicial') {
            orphanDamage += (m.damage || 0);
            if ((m.count || 1) > orphanMaxLv) orphanMaxLv = m.count;
          } else {
            m.title = cleanT;
            validMoves.push(m);
          }
        }

        if (orphanDamage > 0 && validMoves.length > 0) {
          const damagingMoves = validMoves.filter(m => !NON_DAMAGING_MOVES.has(m.title.toLowerCase()));
          const targets = damagingMoves.length > 0 ? damagingMoves : validMoves;
          let totalWeight = 0;
          for (const t of targets) totalWeight += (t.count || 1);
          for (const t of targets) {
            const share = totalWeight > 0 ? (t.count || 1) / totalWeight : 1 / targets.length;
            t.damage = Math.round((t.damage || 0) + orphanDamage * share);
          }
        } else if (orphanDamage > 0 && validMoves.length === 0) {
          const knownStarters = r.pokemon && starterMovesByPoke[r.pokemon.toLowerCase()];
          const fallbackName = (knownStarters && knownStarters[0]) ? knownStarters[0] : 'Ataque Base';
          validMoves.push({
            title: fallbackName,
            count: orphanMaxLv,
            bonded: false,
            damage: Math.round(orphanDamage)
          });
        }

        validMoves.sort((a, b) => (b.damage || 0) - (a.damage || 0) || (b.count || 1) - (a.count || 1));
        r.moves = validMoves;
      }

      cleaned.push(r);
    }
    return cleaned;
  }

  try {
    const savedHist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    runHistory = sanitizeExistingHistory(savedHist);
    saveHistoryToStorage();
  } catch (_) {}

  // Almacenamiento del mapa y Co-op
  const chunks = new Map();
  const allyExploredZones = new Map();
  const trackedEntities = new Map();
  const alliesByName = new Map();
  const rememberedObjects = new Map();
  const permanentProps = new Map();
  const trail = [];

  // Almacenamiento de Estadísticas de la Run
  const passiveUpgrades = new Map();
  const activeMoves = new Map();
  let equippedItem = null;
  let pendingBondFirstMove = null;
  let bondOrderSeq = 1;
  let currentLevel = 1;
  let companionName = '';
  let localPlayerNick = '';

  // Medidor de Daño Real y DPS Máximo
  const activeFloatingTexts = [];
  const damageEvents = [];
  let totalDamageDealt = 0;
  let unassignedInitialDamage = 0;
  let maxSingleHit = 0;
  let totalHitsCount = 0;
  let maxDpsRecorded = 0;

  let lastPokemonDraw = null;

  const RUN_OVERLAYS = new Set([
    'scr-pause',
    'scr-levelup',
    'scr-bond',
    'scr-item'
  ]);

  // ------------------------------------------------------------------
  // ESTILOS DEL HUD IN-GAME Y DEL MODAL NATIVO DE HISTORIAL (100% NATIVO PMD)
  // ------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    /* ============ PokéSurvivor PMD Native Styles for Minimap & Historial ============ */
    :root {
      --psm-font: 'Pixelify', 'Segoe UI', system-ui, sans-serif;
      --psm-box1: #2c519f;
      --psm-box2: #1a3170;
      --psm-edge: #f4f8ff;
      --psm-edge-in: #5b83d6;
      --psm-edge-out: #0b1838;
      --psm-gold: #ffd23f;
      --psm-gold2: #f0a31e;
      --psm-muted: #b9cbf0;
      --psm-green: #5fe08a;
      --psm-red: #ff5f6d;
      --psm-shadow: #0a1430;
      --psm-ink: #ffffff;
    }

    /* 1. HUD In-Game integrado: Minimapa abajo a la derecha y Panel de Daño arriba a la izquierda */
    #psm-map-panel,
    #psm-stats-panel {
      position: fixed;
      z-index: 900;
      box-sizing: border-box;
      overflow: hidden;
      color: var(--psm-ink);
      background: linear-gradient(180deg, rgba(44, 81, 159, .93), rgba(26, 49, 112, .96));
      border: 3px solid var(--psm-edge);
      border-radius: 12px;
      box-shadow: 0 0 0 2.5px var(--psm-edge-out), inset 0 0 0 2px var(--psm-edge-in), 0 12px 36px rgba(0,0,0,.6);
      font: 13px/1.35 var(--psm-font);
      -webkit-font-smoothing: none;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      user-select: none;
      backdrop-filter: blur(4px);
      display: none;
      transition: opacity .15s;
    }

    #psm-map-panel.psm-in-run {
      display: block;
    }

    #psm-stats-panel.psm-in-run {
      display: flex;
    }

    /* Panel Minimapa: abajo a la derecha por defecto */
    #psm-map-panel {
      bottom: 14px;
      right: 14px;
      top: auto;
      left: auto;
      width: 264px;
    }

    /* Panel Daño / Stats: arriba a la izquierda bajo la barra de vida por defecto */
    #psm-stats-panel {
      top: 75px;
      left: 14px;
      bottom: auto;
      right: auto;
      width: 250px;
      max-height: calc(100vh - 90px);
      flex-direction: column;
    }

    .psm-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 8px;
      background: linear-gradient(180deg, rgba(255, 255, 255, .12), rgba(0, 0, 0, .18));
      border-bottom: 2px solid rgba(244, 248, 255, .25);
      cursor: grab;
      flex-shrink: 0;
    }

    .psm-panel-head:active {
      cursor: grabbing;
    }

    .psm-head-title {
      font: 700 12px/1 var(--psm-font);
      color: var(--psm-gold);
      letter-spacing: .04em;
      text-transform: uppercase;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      white-space: nowrap;
    }

    .psm-head-left {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .psm-map-filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      font: 700 11px/1 var(--psm-font);
      border-radius: 6px;
      background: rgba(0, 0, 0, .45);
      border: 1.5px solid rgba(244, 248, 255, .25);
      color: var(--psm-muted);
      cursor: pointer;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      transition: all .15s ease;
      white-space: nowrap;
    }

    .psm-map-filter-btn:hover {
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      background: rgba(255, 210, 63, .16);
    }

    .psm-map-filter-btn.active {
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      background: rgba(255, 210, 63, .22);
      box-shadow: 0 0 6px rgba(255, 210, 63, .35);
    }

    .psm-head-actions {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    #psm-passive-zoom {
      font-size: 11px;
      color: var(--psm-gold);
      margin: 0 2px;
      font-weight: 700;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    .psm-fov-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 5px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 6px;
      background: rgba(0, 0, 0, .45);
      border: 1.5px solid rgba(244, 248, 255, .25);
      color: var(--psm-muted);
      cursor: pointer;
      white-space: nowrap;
      margin: 0 2px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      transition: all .15s ease;
    }

    .psm-fov-badge:hover {
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      background: rgba(255, 210, 63, .12);
    }

    .psm-fov-badge.psm-fov-active {
      background: rgba(255, 210, 63, .22);
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      box-shadow: 0 0 6px rgba(255, 210, 63, .35);
    }

    .psm-ctrl-btn {
      width: 23px;
      height: 23px;
      padding: 0;
      color: var(--psm-ink);
      background: linear-gradient(180deg, #3d67c0, #26468f);
      border: 2px solid var(--psm-edge);
      border-radius: 7px;
      box-shadow: 0 0 0 1px var(--psm-edge-out), 0 2px 0 var(--psm-edge-out);
      cursor: pointer;
      font: 700 13px/1 var(--psm-font);
      -webkit-font-smoothing: none;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: filter .1s, transform .06s;
    }

    .psm-ctrl-btn:hover {
      filter: brightness(1.15);
    }

    .psm-ctrl-btn:active {
      transform: translateY(1px);
      box-shadow: 0 0 0 1px var(--psm-edge-out), 0 1px 0 var(--psm-edge-out);
    }

    #psm-map-body {
      position: relative;
      padding: 8px 10px 9px;
    }

    #psm-map-details-wrap {
      display: block;
    }

    #psm-map-panel.psm-clean-map #psm-map-details-wrap {
      display: none !important;
    }

    #psm-map-panel.psm-clean-map #psm-map-body {
      padding-bottom: 8px;
    }

    #psm-stats-body {
      position: relative;
      padding: 8px;
      box-sizing: border-box;
      overflow-y: auto;
      max-height: calc(100vh - 130px);
      scrollbar-width: thin;
      scrollbar-color: rgba(244, 248, 255, .3) transparent;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    #psm-expandable-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 2px;
      padding-top: 6px;
      border-top: 1.5px solid rgba(244, 248, 255, .18);
    }

    #psm-expandable-section[hidden] {
      display: none !important;
    }

    #psm-map-wrap {
      position: relative;
      width: 100%;
      height: var(--psm-content-h, 244px);
      background: #0d1a15;
      border-radius: 9px;
      border: 2px solid rgba(244, 248, 255, .3);
      box-shadow: 0 0 0 1px var(--psm-edge-out), inset 0 0 10px rgba(0, 0, 0, .7);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #psm-passive-map {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #0d1a15;
      image-rendering: pixelated;
      cursor: grab;
    }

    #psm-passive-map:active {
      cursor: grabbing;
    }

    #psm-recenter-btn {
      position: absolute;
      bottom: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      padding: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: linear-gradient(180deg, #ffe37a, #f0a31e);
      color: #3a2300;
      border: 2px solid #fff7d6;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--psm-edge-out), 0 3px 8px rgba(0,0,0,.6);
      cursor: pointer;
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
      text-shadow: 1px 1px 0 rgba(255,255,255,.4);
    }

    #psm-recenter-btn.visible {
      display: flex;
    }

    .psm-stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 8px;
    }

    .psm-stat-grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }

    .psm-stat-card {
      background: rgba(0, 0, 0, .26);
      border: 2px solid rgba(244, 248, 255, .2);
      border-radius: 8px;
      padding: 5px 8px;
      display: flex;
      flex-direction: column;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    .psm-stat-card span {
      font-size: 10px;
      color: var(--psm-muted);
      text-transform: uppercase;
      letter-spacing: .04em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 700;
    }

    .psm-stat-card strong {
      font-size: 16px;
      color: var(--psm-gold);
      font-weight: 700;
    }

    .psm-sec-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--psm-muted);
      letter-spacing: .05em;
      text-transform: uppercase;
      border-bottom: 2px solid rgba(244, 248, 255, .2);
      padding-bottom: 3px;
      margin: 4px 0 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    .psm-upgrade-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 6px;
    }

    .psm-upg-row {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      background: rgba(0, 0, 0, .24);
      border: 1.5px solid rgba(244, 248, 255, .18);
      padding: 4px 8px;
      border-radius: 7px;
      font-size: 12px;
      overflow: hidden;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      transition: background .1s, border-color .1s;
    }

    .psm-upg-row:hover {
      background: rgba(255, 255, 255, .08);
      border-color: rgba(244, 248, 255, .35);
    }

    .psm-dmg-bar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: rgba(255, 210, 63, .22);
      pointer-events: none;
      z-index: 0;
      border-right: 1.5px solid rgba(255, 210, 63, .45);
    }

    .psm-upg-row > * {
      position: relative;
      z-index: 1;
    }

    .psm-upg-row.psm-row-item {
      background: rgba(255, 210, 63, .12);
      border: 1.5px solid rgba(255, 210, 63, .35);
    }

    .psm-upg-row.psm-row-bonded {
      background: rgba(196, 123, 255, .14);
      border: 1.5px solid rgba(196, 123, 255, .4);
    }

    .psm-upg-name {
      color: var(--psm-ink);
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .psm-upg-dmg {
      font-size: 11px;
      color: var(--psm-gold);
      font-weight: 700;
      white-space: nowrap;
    }

    .psm-upg-type {
      font-size: 10px;
      color: var(--psm-muted);
      background: rgba(0, 0, 0, .35);
      border: 1px solid rgba(244, 248, 255, .2);
      padding: 1px 5px;
      border-radius: 4px;
    }

    .psm-upg-count {
      background: rgba(95, 224, 138, .18);
      color: var(--psm-green);
      border: 1px solid rgba(95, 224, 138, .35);
      padding: 1px 6px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
    }

    .psm-upg-val {
      color: var(--psm-green);
      font-weight: 700;
      font-size: 11px;
      white-space: nowrap;
    }

    .psm-empty-msg {
      color: var(--psm-muted);
      font-size: 11px;
      text-align: center;
      padding: 12px 6px;
      font-style: italic;
      text-shadow: 1px 1px 0 var(--psm-shadow);
    }

    #psm-passive-status {
      min-height: 16px;
      margin-top: 6px;
      color: var(--psm-muted);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    #psm-passive-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 8px;
      padding-top: 6px;
      color: var(--psm-ink);
      font-size: 11px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    .psm-key {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 5px;
      transition: opacity .15s, background .15s;
    }

    .psm-key:hover {
      background: rgba(255, 255, 255, .1);
    }

    .psm-key.psm-off {
      opacity: 0.35;
      text-decoration: line-through;
    }

    .psm-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
      box-shadow: 0 0 0 1px var(--psm-edge-out);
    }

    .psm-boss-diamond {
      width: 9px;
      height: 9px;
      display: inline-block;
      flex-shrink: 0;
      background: var(--psm-gold);
      border: 1px solid #fff2c0;
      box-sizing: border-box;
      transform: rotate(45deg);
      box-shadow: 0 0 0 1px var(--psm-edge-out);
    }

    #psm-bottom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding-top: 6px;
    }

    #psm-passive-help {
      color: var(--psm-muted);
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      text-shadow: 1px 1px 0 var(--psm-shadow);
    }

    #psm-size-controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    #psm-size-reset {
      width: 10px;
      height: 10px;
      padding: 0;
      border-radius: 50%;
      background: rgba(185, 203, 240, .35);
      border: 1px solid var(--psm-edge);
      cursor: pointer;
      box-shadow: 0 0 0 1px var(--psm-edge-out);
    }

    #psm-size-reset.modified {
      background: var(--psm-gold);
      border-color: #fff7d6;
      box-shadow: 0 0 6px rgba(255, 210, 63, .75);
    }

    #psm-resize-grip {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: nwse-resize;
      color: var(--psm-gold);
      font-size: 12px;
      line-height: 1;
      text-shadow: 1px 1px 0 var(--psm-shadow);
    }

    #psm-map-panel.psm-folded {
      width: 200px !important;
    }

    #psm-map-panel.psm-folded #psm-map-body {
      display: none;
    }

    #psm-stats-panel.psm-folded {
      width: 200px !important;
    }

    #psm-stats-panel.psm-folded #psm-stats-body {
      display: none;
    }

    /* --------------------------------------------------------
       2. MODAL NATIVO DE HISTORIAL (100% Estética PMD / .scr)
       -------------------------------------------------------- */
    #psm-history-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483500;
      background: radial-gradient(circle at 50% 40%, rgba(10,20,50,.75), rgba(3,6,16,.92));
      backdrop-filter: blur(5px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font: 15px/1.35 var(--psm-font);
      -webkit-font-smoothing: none;
      color: var(--psm-ink);
      user-select: none;
      animation: fade .2s ease-out;
    }

    #psm-history-modal.open {
      display: flex;
    }

    .psm-modal-box {
      width: 100%;
      max-width: 560px;
      max-height: 86vh;
      background: linear-gradient(180deg, var(--psm-box1), var(--psm-box2));
      border: 3px solid var(--psm-edge);
      border-radius: 12px;
      box-shadow: 0 0 0 3px var(--psm-edge-out), inset 0 0 0 2px var(--psm-edge-in), 0 18px 50px rgba(0,0,0,.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      text-shadow: 2px 2px 0 var(--psm-shadow);
      animation: pop .22s ease-out;
    }

    .psm-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      background: linear-gradient(180deg, rgba(255, 255, 255, .14), rgba(0, 0, 0, .18));
      border-bottom: 2px solid rgba(244, 248, 255, .25);
    }

    .psm-modal-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: .5px;
      color: var(--psm-gold);
      display: flex;
      align-items: center;
      gap: 10px;
      text-shadow: 2px 2px 0 var(--psm-shadow);
    }

    .psm-modal-close {
      padding: 6px 14px;
      border: 2px solid var(--psm-edge);
      border-radius: 8px;
      background: linear-gradient(180deg, #3d67c0, #26468f);
      box-shadow: 0 0 0 2px var(--psm-edge-out), 0 3px 0 var(--psm-edge-out);
      font: 700 13px var(--psm-font);
      -webkit-font-smoothing: none;
      color: var(--psm-ink);
      cursor: pointer;
      text-shadow: 2px 2px 0 var(--psm-shadow);
      transition: transform .06s, filter .12s;
    }

    .psm-modal-close:hover {
      filter: brightness(1.15);
    }

    .psm-modal-close:active {
      transform: translateY(2px);
      box-shadow: 0 0 0 2px var(--psm-edge-out), 0 1px 0 var(--psm-edge-out);
    }

    .psm-modal-content {
      padding: 16px 18px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(244,248,255,.3) transparent;
      flex: 1;
    }

    .psm-run-card {
      background: rgba(0, 0, 0, .24);
      border: 2px solid rgba(244, 248, 255, .25);
      border-radius: 10px;
      margin-bottom: 9px;
      overflow: hidden;
      transition: transform .08s, background .12s, border-color .12s;
    }

    .psm-run-card:hover {
      background: rgba(255, 255, 255, .08);
      border-color: var(--psm-edge);
      transform: translateX(2px);
    }

    .psm-run-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      cursor: pointer;
      font-size: 14px;
      transition: background .12s;
      text-shadow: 2px 2px 0 var(--psm-shadow);
    }

    .psm-run-poke {
      font-weight: 700;
      color: var(--psm-gold);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .psm-run-meta {
      color: var(--psm-muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .psm-run-dps {
      color: var(--psm-green);
      font-weight: 700;
      font-size: 13px;
      white-space: nowrap;
      min-width: 66px;
      text-align: right;
    }

    .psm-run-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .psm-run-share {
      color: var(--psm-ink);
      background: linear-gradient(180deg, #3d67c0, #26468f);
      border: 1.5px solid var(--psm-edge);
      border-radius: 6px;
      cursor: pointer;
      font: 700 11px/1 var(--psm-font);
      padding: 4px 7px;
      white-space: nowrap;
      box-shadow: 0 0 0 1px var(--psm-edge-out), 0 2px 0 var(--psm-edge-out);
      text-shadow: 1px 1px 0 var(--psm-shadow);
      transition: filter .12s, transform .06s, border-color .12s;
    }

    .psm-run-share:hover {
      filter: brightness(1.15);
      border-color: var(--psm-gold);
    }

    .psm-run-share.copied {
      background: linear-gradient(180deg, #2f9a52, #1e6b38);
      border-color: var(--psm-gold);
      color: var(--psm-gold);
    }

    .psm-run-del {
      color: var(--psm-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 16px;
      padding: 0 4px;
      line-height: 1;
      font-weight: 700;
    }

    .psm-run-del:hover {
      color: var(--psm-red);
    }

    /* Estilos pestaña DAÑO (v3.4 - Estilo pokesurvivor-mod) */
    .psm-dmg-topbar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      padding-bottom: 5px;
      border-bottom: 2px solid rgba(11, 24, 56, .65);
    }

    .psm-dmg-title {
      font-weight: 700;
      color: var(--psm-gold);
      font-size: 13px;
      letter-spacing: .04em;
    }

    .psm-dmg-clock {
      font-weight: 700;
      color: var(--psm-muted);
      font-size: 12.5px;
    }

    .psm-dmg-live-pill {
      margin-left: auto;
      font-weight: 700;
      font-size: 12px;
      color: var(--psm-green);
      background: rgba(11, 24, 56, .75);
      border: 1.5px solid rgba(95, 224, 138, .4);
      border-radius: 5px;
      padding: 1px 6px;
    }

    .psm-mejoras-btn {
      font: 700 11.5px/1 var(--psm-font);
      color: #fff;
      background: #0b1838;
      border: 2px solid #5b83d6;
      border-radius: 5px;
      height: 22px;
      padding: 0 7px;
      cursor: pointer;
      text-shadow: 1px 1px 0 var(--psm-shadow);
      transition: border-color .12s, background .12s, color .12s;
    }

    .psm-mejoras-btn:hover,
    .psm-mejoras-btn.active {
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      background: #132757;
    }

    .psm-timers-box {
      display: grid;
      gap: 2px;
      padding: 2px 2px 6px;
      font-size: 11.5px;
      color: var(--psm-muted);
      border-bottom: 1.5px solid rgba(244, 248, 255, .15);
      margin-bottom: 6px;
    }

    .psm-timers-box:empty {
      display: none;
    }

    .psm-timers-box b {
      color: #ffffff;
      font-weight: 700;
    }

    .psm-player-rows {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 6px;
    }

    .psm-pl-row {
      position: relative;
      padding: 5px 7px;
      border-radius: 6px;
      background: #0b1838;
      border: 1.5px solid rgba(91, 131, 214, .35);
      overflow: hidden;
    }

    .psm-pl-row.me {
      cursor: pointer;
      border-color: rgba(255, 210, 63, .45);
    }

    .psm-pl-row.me:hover {
      border-color: var(--psm-gold);
    }

    .psm-pl-bar {
      position: absolute;
      inset: 0 auto 0 0;
      opacity: .35;
      pointer-events: none;
    }

    .psm-pl-line {
      position: relative;
      display: flex;
      gap: 6px;
      align-items: baseline;
      font-size: 13px;
    }

    .psm-pl-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }

    .psm-pl-dmg {
      font-weight: 700;
      color: #ffffff;
    }

    .psm-pl-sub {
      position: relative;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--psm-muted);
      margin-top: 1px;
    }

    .psm-pl-hp {
      position: relative;
      height: 4px;
      margin-top: 4px;
      border-radius: 2px;
      background: #26304f;
      overflow: hidden;
    }

    .psm-pl-hp i {
      position: absolute;
      inset: 0 auto 0 0;
      background: #5fe08a;
    }

    .psm-pl-hp.low i {
      background: #ffcb3d;
    }

    .psm-pl-hp.crit i {
      background: #ff5f6d;
    }

    .psm-pl-dead {
      color: #ff5f6d;
      font-weight: 700;
    }

    .psm-pl-moves {
      position: relative;
      margin-top: 5px;
      padding-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, .14);
      display: grid;
      gap: 2px;
      font-size: 11.5px;
    }

    .psm-pl-mv {
      display: flex;
      gap: 6px;
      align-items: baseline;
    }

    .psm-pl-mv span:first-child {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #ffffff;
    }

    .psm-pl-mv span:nth-child(2) {
      font-weight: 700;
      color: #ffffff;
    }

    .psm-pl-mv span:last-child {
      color: var(--psm-muted);
      min-width: 34px;
      text-align: right;
    }

    .psm-pl-hint {
      position: relative;
      font-size: 10.5px;
      color: var(--psm-muted);
      margin-top: 3px;
    }

    .psm-buffs-box {
      padding: 6px 8px;
      margin-bottom: 6px;
      background: rgba(11, 24, 56, .65);
      border: 1.5px solid rgba(91, 131, 214, .45);
      border-radius: 7px;
      font-size: 11.5px;
      display: grid;
      gap: 2.5px;
    }

    .psm-buffs-box[hidden] {
      display: none !important;
    }

    .psm-buffs-box h4 {
      margin: 2px 0 3px;
      font-size: 11px;
      letter-spacing: .06em;
      color: var(--psm-gold);
      text-transform: uppercase;
    }

    .psm-buffs-box h4:not(:first-child) {
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid rgba(244, 248, 255, .15);
    }

    .psm-buffs-box .kv {
      display: flex;
      justify-content: space-between;
      gap: 6px;
    }

    .psm-buffs-box .kv span:first-child {
      flex: 1;
      color: var(--psm-muted);
    }

    .psm-buffs-box .kv b {
      color: #ffffff;
      white-space: nowrap;
    }

    .psm-run-details {
      display: none;
      padding: 10px 12px;
      border-top: 1.5px solid rgba(244, 248, 255, .18);
      background: rgba(0, 0, 0, .32);
      font-size: 13px;
    }

    .psm-run-card.expanded .psm-run-details {
      display: block;
    }

    .psm-hist-sub {
      font-size: 12px;
      font-weight: 700;
      color: var(--psm-gold);
      text-transform: uppercase;
      letter-spacing: .04em;
      margin: 8px 0 5px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    /* Botón fallback en caso de no encontrar contenedor estándar en el lobby */
    .psm-injected-btn-fallback {
      cursor: pointer;
    }

    /* --------------------------------------------------------
       BOTÓN DE HISTORIAL EN EL MENÚ LATERAL DEL LOBBY (#scr-menu)
       -------------------------------------------------------- */
    #psm-lobby-hist-btn,
    .psm-lobby-hist-btn {
      appearance: none !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      margin: 0 !important;
      text-decoration: none !important;
      cursor: pointer !important;
    }

    #psm-lobby-hist-btn:hover,
    .psm-lobby-hist-btn:hover,
    #psm-lobby-hist-btn:focus-visible,
    .psm-lobby-hist-btn:focus-visible {
      background: rgba(255, 255, 255, .08) !important;
      outline: none !important;
    }

    #psm-lobby-hist-btn .mi-ico,
    .psm-lobby-hist-btn .mi-ico {
      grid-row: span 2 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 22px !important;
      line-height: 1 !important;
    }

    #psm-lobby-hist-btn .mi-title,
    .psm-lobby-hist-btn .mi-title {
      grid-column: 2 !important;
      display: block !important;
      font-size: inherit !important;
      font-weight: 700 !important;
      line-height: 1.15 !important;
      color: #ffffff !important;
      letter-spacing: .5px !important;
      text-shadow: 2px 2px 0 var(--shadow, #0a1430) !important;
    }

    #psm-lobby-hist-btn small,
    .psm-lobby-hist-btn small {
      grid-column: 2 !important;
      display: block !important;
      font-size: 13px !important;
      font-weight: 400 !important;
      color: var(--muted, #b9cbf0) !important;
      letter-spacing: 0 !important;
      line-height: 1.25 !important;
      text-shadow: 1px 1px 0 var(--shadow, #0a1430) !important;
    }

    /* --------------------------------------------------------
       MENÚ DE PAUSA IN-GAME (#scr-pause) - DISTRIBUCIÓN EN PAREJAS (50% / 50%)
       -------------------------------------------------------- */
    #scr-pause .sound-inline {
      margin: 6px auto 12px !important;
    }

    #scr-pause .psm-pause-row {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 12px !important;
      width: 100% !important;
      margin: 5px 0 !important;
      box-sizing: border-box !important;
    }

    #scr-pause .psm-pause-row > .btn,
    #scr-pause .psm-pause-row > button {
      flex: 1 1 calc(50% - 6px) !important;
      width: calc(50% - 6px) !important;
      min-width: 0 !important;
      height: 44px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      padding: 0 12px !important;
      box-sizing: border-box !important;
      background: linear-gradient(180deg, #3d67c0, #26468f) !important;
      background-color: #2b4da0 !important;
      border: 3px solid #ffffff !important;
      border-radius: 9px !important;
      box-shadow: 0 0 0 2px #0b1838, 0 4px 0 #0b1838 !important;
      color: #ffffff !important;
      font: 700 16px/1 var(--font, 'Pixelify', 'Segoe UI', system-ui, sans-serif) !important;
      letter-spacing: .02em !important;
      text-shadow: 2px 2px 0 #0a1430 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      user-select: none !important;
      outline: none !important;
      text-decoration: none !important;
      transition: filter .12s, transform .06s !important;
    }

    #scr-pause .psm-pause-row > .btn.gold,
    #scr-pause .psm-pause-row > button.gold {
      background: linear-gradient(180deg, #ffe37a, #f0a31e) !important;
      color: #3a2300 !important;
      text-shadow: 1px 1px 0 rgba(255, 255, 255, .4) !important;
      border-color: #fff7d6 !important;
    }

    #scr-pause .psm-pause-row > .btn:hover,
    #scr-pause .psm-pause-row > button:hover {
      filter: brightness(1.15) !important;
    }

    #scr-pause .psm-pause-row > .btn:active,
    #scr-pause .psm-pause-row > button:active {
      transform: translateY(2px) !important;
      box-shadow: 0 0 0 2px #0b1838, 0 2px 0 #0b1838 !important;
    }

    .psm-btn-ico {
      font-size: 16px !important;
      line-height: 1 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
    }

    @media (max-height: 520px) {
      #scr-pause .psm-pause-row > .btn,
      #scr-pause .psm-pause-row > button {
        height: 36px !important;
        padding: 0 8px !important;
        font-size: 13.5px !important;
      }
    }

    /* --------------------------------------------------------
       PANTALLAS MODALES EN PARTIDA Y TOPBAR DEL JUEGO
       -------------------------------------------------------- */
    #topbar {
      z-index: 100 !important;
      pointer-events: auto !important;
    }

    #topbar button,
    #topbar .btn,
    #topbar [id^="btn-"],
    #topbar * {
      pointer-events: auto !important;
    }

    #scr-pause:not(.hidden),
    #scr-levelup:not(.hidden),
    #scr-bond:not(.hidden),
    #scr-item:not(.hidden),
    #scr-over:not(.hidden) {
      z-index: 50;
    }

    /* --------------------------------------------------------
       BARRA DE VIDA Y WIDGET DE BUFOS PERSONALIZABLES
       -------------------------------------------------------- */
    #psm-custom-hp-bar,
    #psm-custom-buffs-bar {
      position: fixed !important;
      z-index: 15;
      user-select: none;
      pointer-events: none !important;
      box-sizing: border-box;
      transition: box-shadow .2s ease, filter .15s ease;
    }

    #psm-custom-hp-bar:not(.psm-editing-ui) *,
    #psm-custom-buffs-bar:not(.psm-editing-ui) * {
      pointer-events: none !important;
    }

    /* Ocultar en el Menú Principal o cuando no haya run activa */
    #psm-custom-hp-bar:not(.psm-in-run):not(.psm-editing-ui),
    #psm-custom-buffs-bar:not(.psm-in-run):not(.psm-editing-ui),
    #psm-map-panel:not(.psm-in-run),
    #psm-stats-panel:not(.psm-in-run),
    #psm-ui-editor-overlay:not(.open) {
      display: none !important;
      pointer-events: none !important;
    }

    #psm-custom-buffs-bar.psm-empty-buffs:not(.psm-editing-ui) {
      display: none !important;
      pointer-events: none !important;
    }

    /* En Pausa, Subida de Nivel, Vínculo, Objeto o Historial (durante la run): quedan detrás del backdrop y atenuados */
    #psm-custom-hp-bar.psm-modal-dimmed:not(.psm-editing-ui),
    #psm-custom-buffs-bar.psm-modal-dimmed:not(.psm-editing-ui) {
      z-index: 4 !important;
      filter: brightness(0.45) !important;
      pointer-events: none !important;
    }

    #psm-map-panel.psm-modal-dimmed,
    #psm-stats-panel.psm-modal-dimmed {
      z-index: 4 !important;
      filter: brightness(0.45) !important;
      pointer-events: none !important;
    }

    #psm-custom-hp-bar.psm-editing-ui,
    #psm-custom-buffs-bar.psm-editing-ui {
      z-index: 2147483010 !important;
      filter: none !important;
      pointer-events: auto !important;
      cursor: grab !important;
      outline: 3px dashed var(--psm-gold) !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 22px rgba(255, 210, 63, .85), inset 0 0 10px rgba(255, 210, 63, .3) !important;
      animation: psm-pulse-border 1.2s infinite alternate ease-in-out !important;
    }

    #psm-custom-hp-bar.psm-editing-ui *,
    #psm-custom-buffs-bar.psm-editing-ui * {
      pointer-events: none !important;
    }

    #psm-custom-hp-bar.psm-editing-ui.psm-dragging,
    #psm-custom-hp-bar.psm-editing-ui:active,
    #psm-custom-buffs-bar.psm-editing-ui.psm-dragging,
    #psm-custom-buffs-bar.psm-editing-ui:active {
      cursor: grabbing !important;
      outline-color: #ffffff !important;
      box-shadow: 0 0 28px rgba(255, 255, 255, .9), 0 0 14px var(--psm-gold) !important;
    }

    @keyframes psm-pulse-border {
      0% { outline-color: rgba(255, 210, 63, .45); }
      100% { outline-color: rgba(255, 210, 63, 1); }
    }

    .psm-hp-edit-tag {
      display: none;
      position: absolute;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--psm-gold);
      color: #0b1838;
      font: 700 10px/1 var(--psm-font);
      padding: 3px 8px;
      border-radius: 4px;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,.6);
      pointer-events: none;
    }

    #psm-custom-hp-bar.psm-editing-ui .psm-hp-edit-tag,
    #psm-custom-buffs-bar.psm-editing-ui .psm-hp-edit-tag {
      display: block;
    }

    /* Orientación Horizontal (Diseño Clásico Nativo PMD - .psm-theme-classic) */
    #psm-custom-hp-bar.psm-orient-horizontal,
    #psm-custom-hp-bar.psm-theme-classic.psm-orient-horizontal {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px;
      background: linear-gradient(180deg, rgba(44, 81, 159, .96), rgba(26, 49, 112, .98));
      border: 2.5px solid var(--psm-edge);
      border-radius: 12px;
      box-shadow: 0 0 0 2px var(--psm-edge-out), inset 0 0 0 1.5px var(--psm-edge-in), 0 8px 24px rgba(0,0,0,.65);
      backdrop-filter: blur(4px);
      min-width: 265px;
    }

    #psm-custom-hp-bar.psm-orient-horizontal .psm-hp-avatar-wrap {
      position: relative;
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(11, 20, 42, .85);
      border: 2px solid var(--psm-gold);
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(255, 210, 63, .35), inset 0 0 4px rgba(0,0,0,.6);
    }

    .psm-hp-avatar {
      font-size: 20px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .psm-hp-sprite-img {
      width: 34px;
      height: 34px;
      image-rendering: pixelated;
      object-fit: contain;
    }

    .psm-hp-badge {
      position: absolute;
      bottom: -4px;
      right: -6px;
      background: linear-gradient(180deg, #ffd23f, #f0a31e);
      color: #122144;
      font: 700 9.5px/1 var(--psm-font);
      padding: 1px 5px;
      border-radius: 6px;
      border: 1px solid #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,.7);
      text-shadow: none;
      z-index: 6;
    }

    #psm-custom-hp-bar.psm-orient-horizontal .psm-hp-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .psm-hp-header-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
    }

    .psm-hp-name {
      font: 700 13px/1 var(--psm-font);
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: .02em;
    }

    .psm-hp-val-top {
      font: 700 11.5px/1 var(--psm-font);
      color: var(--psm-gold);
      white-space: nowrap;
    }

    /* Pista de vida con segmentos tipo PMD / Brawl Stars */
    .psm-hp-track {
      position: relative;
      height: 14px;
      background: #081022;
      border-radius: 6px;
      border: 1.5px solid rgba(244, 248, 255, .3);
      box-shadow: inset 0 2px 4px rgba(0,0,0,.8);
      overflow: hidden;
    }

    .psm-hp-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      border-radius: 4px;
      transition: width .18s ease-out;
    }

    .psm-hp-fill.ghost {
      background: #ffffff;
      opacity: .6;
      transition: width .5s ease-out .15s;
      z-index: 1;
    }

    .psm-hp-fill.live {
      background: linear-gradient(180deg, #5fe08a 0%, #22c55e 50%, #15803d 100%);
      z-index: 2;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .4);
    }

    .psm-hp-fill.live.low {
      background: linear-gradient(180deg, #fde047 0%, #eab308 50%, #a16207 100%);
    }

    .psm-hp-fill.live.crit {
      background: linear-gradient(180deg, #ff5f6d 0%, #ef4444 50%, #b91c1c 100%);
    }

    .psm-hp-fill.shield {
      background: linear-gradient(180deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%);
      z-index: 3;
      opacity: .85;
      box-shadow: 0 0 6px rgba(103, 232, 249, .6);
    }

    .psm-hp-segments {
      position: absolute;
      inset: 0;
      z-index: 4;
      pointer-events: none;
      background: repeating-linear-gradient(90deg, transparent, transparent 24%, rgba(0, 0, 0, .45) 24%, rgba(0, 0, 0, .45) 25%);
    }

    .psm-hp-overlay-txt {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
      font: 700 10px/1 var(--psm-font);
      color: #ffffff;
      text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000;
      pointer-events: none;
    }

    /* Orientación Vertical (Diseño Clásico Nativo PMD - .psm-theme-classic) */
    #psm-custom-hp-bar.psm-orient-vertical,
    #psm-custom-hp-bar.psm-theme-classic.psm-orient-vertical {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 9px 8px;
      background: linear-gradient(180deg, rgba(44, 81, 159, .96), rgba(26, 49, 112, .98));
      border: 2.5px solid var(--psm-edge);
      border-radius: 14px;
      box-shadow: 0 0 0 2px var(--psm-edge-out), inset 0 0 0 1.5px var(--psm-edge-in), 0 8px 24px rgba(0,0,0,.65);
      backdrop-filter: blur(4px);
      width: 58px;
      height: 190px;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-avatar-wrap {
      position: relative;
      width: 36px;
      height: 36px;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(11, 20, 42, .85);
      border: 2px solid var(--psm-gold);
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(255, 210, 63, .35);
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-main {
      flex: 1;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-height: 0;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-header-line {
      display: none;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-track {
      flex: 1;
      width: 20px;
      height: 100%;
      border-radius: 8px;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-fill {
      top: auto;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100% !important;
      transition: height .18s ease-out;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-fill.ghost {
      transition: height .5s ease-out .15s;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-segments {
      background: repeating-linear-gradient(180deg, transparent, transparent 24%, rgba(0, 0, 0, .45) 24%, rgba(0, 0, 0, .45) 25%);
    }

    .psm-hp-val-bottom {
      display: none;
      font: 700 9.5px/1 var(--psm-font);
      color: #ffffff;
      text-shadow: 1px 1px 0 var(--psm-shadow);
      white-space: nowrap;
      text-align: center;
    }

    #psm-custom-hp-bar.psm-orient-vertical .psm-hp-val-bottom {
      display: block;
    }

    /* Tema Minimalista Nativo (.psm-theme-minimal) */
    #psm-custom-hp-bar.psm-theme-minimal {
      background: transparent !important;
      border: none !important;
      box-shadow: none;
      backdrop-filter: none !important;
    }

    #psm-custom-hp-bar.psm-theme-minimal.psm-orient-horizontal {
      padding: 2px 4px;
      min-width: 215px;
      gap: 0;
    }

    #psm-custom-hp-bar.psm-theme-minimal.psm-orient-vertical {
      padding: 4px;
      width: 44px;
      height: 170px;
      gap: 4px;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-avatar-wrap {
      display: none !important;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-header-line {
      margin-bottom: 3px;
      padding: 0 2px;
      text-shadow: 2px 2px 0 #0a1430, -1px -1px 0 #0a1430, 1px -1px 0 #0a1430, -1px 1px 0 #0a1430;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-name {
      font: 700 13.5px/1 var(--psm-font);
      color: #ffffff;
      text-shadow: 2px 2px 0 #0a1430, -1px -1px 0 #0a1430, 1px -1px 0 #0a1430, -1px 1px 0 #0a1430;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-val-top {
      font: 700 12.5px/1 var(--psm-font);
      color: var(--psm-gold);
      text-shadow: 2px 2px 0 #0a1430, -1px -1px 0 #0a1430, 1px -1px 0 #0a1430, -1px 1px 0 #0a1430;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-track {
      height: 16px;
      background: rgba(10, 20, 48, .88);
      border: 2px solid #f4f8ff;
      border-radius: 7px;
      box-shadow: 0 0 0 2px #0b1838, 0 3px 8px rgba(0,0,0,.6);
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-fill.live,
    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-fill.live.low,
    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-fill.live.crit {
      background: #ff5f6d !important;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .38);
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-segments {
      display: none;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-overlay-txt {
      font: 700 11px/1 var(--psm-font);
      color: #ffffff;
      text-shadow: 1.5px 1.5px 0 #0a1430, -1px -1px 0 #0a1430, 1px -1px 0 #0a1430, -1px 1px 0 #0a1430;
    }

    #psm-custom-hp-bar.psm-theme-minimal .psm-hp-val-bottom {
      font: 700 10.5px/1 var(--psm-font);
      color: var(--psm-gold);
      text-shadow: 1.5px 1.5px 0 #0a1430, -1px -1px 0 #0a1430, 1px -1px 0 #0a1430, -1px 1px 0 #0a1430;
    }

    /* --------------------------------------------------------
       WIDGET DE BUFOS TEMPORALES Y ESTADOS (#psm-custom-buffs-bar)
       -------------------------------------------------------- */
    #psm-custom-buffs-bar {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 2px;
      min-height: 22px;
      max-width: 420px;
    }

    #psm-buffs-pills-wrap {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .psm-buff-pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px 6px 7px;
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(16, 30, 68, .92), rgba(8, 16, 38, .96));
      border: 1.5px solid var(--psm-buff-col, #7fe0ff);
      box-shadow: 0 0 0 1.5px #0b1838, 0 3px 8px rgba(0, 0, 0, .55);
      font: 700 11.5px/1 var(--psm-font);
      color: #ffffff;
      text-shadow: 1.5px 1.5px 0 #0a1430, -1px -1px 0 #0a1430;
      overflow: hidden;
      white-space: nowrap;
    }

    .psm-buff-ico {
      font-size: 11px;
      line-height: 1;
      filter: drop-shadow(1px 1px 0 #0a1430);
    }

    .psm-buff-label {
      color: var(--psm-buff-col, #7fe0ff);
      letter-spacing: .03em;
      font-weight: 700;
    }

    .psm-buff-timer {
      color: #eaf2ff;
      font-size: 10px;
      opacity: .92;
      margin-left: 1px;
    }

    .psm-buff-prog {
      position: absolute;
      left: 7px;
      right: 7px;
      bottom: 2px;
      height: 2.5px;
      background: rgba(255, 255, 255, .16);
      border-radius: 2px;
      overflow: hidden;
    }

    .psm-buff-prog > i {
      display: block;
      height: 100%;
      border-radius: 2px;
      background: var(--psm-buff-col, #7fe0ff);
      transition: width .12s linear;
    }

    /* --------------------------------------------------------
       OVERLAY Y TOOLBAR DEL EDITOR DE UI
       -------------------------------------------------------- */
    #psm-ui-editor-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      background: rgba(4, 9, 22, .6);
      backdrop-filter: blur(2px);
      background-image: radial-gradient(rgba(244, 248, 255, .15) 1px, transparent 1px);
      background-size: 24px 24px;
      display: none;
      flex-direction: column;
      align-items: center;
      pointer-events: none !important;
      user-select: none;
      font: 13px/1.35 var(--psm-font);
      animation: fade .15s ease-out;
    }

    #psm-ui-editor-overlay.open {
      display: flex;
    }

    .psm-editor-toolbar {
      pointer-events: auto !important;
      margin-top: 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: linear-gradient(180deg, rgba(44, 81, 159, .96), rgba(26, 49, 112, .98));
      border: 3px solid var(--psm-edge);
      border-radius: 14px;
      box-shadow: 0 0 0 2.5px var(--psm-edge-out), inset 0 0 0 2px var(--psm-edge-in), 0 14px 40px rgba(0,0,0,.75);
      color: var(--psm-ink);
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      max-width: 90vw;
    }

    .psm-editor-title {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    .psm-editor-title span:first-child {
      font: 700 14px/1 var(--psm-font);
      color: var(--psm-gold);
      letter-spacing: .05em;
    }

    .psm-editor-subtitle {
      font-size: 11px;
      color: var(--psm-muted);
    }

    .psm-editor-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .psm-editor-tool-btn {
      height: 28px;
      padding: 0 10px;
      background: rgba(0, 0, 0, .35);
      border: 1.5px solid rgba(244, 248, 255, .28);
      border-radius: 7px;
      color: var(--psm-ink);
      font: 700 12px/1 var(--psm-font);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      text-shadow: 1px 1px 0 var(--psm-shadow);
      transition: all .12s;
    }

    .psm-editor-tool-btn:hover {
      border-color: var(--psm-gold);
      color: var(--psm-gold);
      background: rgba(255, 210, 63, .12);
    }

    .psm-editor-scale-ctrl {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(0, 0, 0, .35);
      border: 1.5px solid rgba(244, 248, 255, .28);
      border-radius: 7px;
      padding: 2px 6px;
      height: 28px;
      box-sizing: border-box;
    }

    .psm-scale-label {
      font-size: 11px;
      color: var(--psm-muted);
    }

    .psm-scale-val {
      font-weight: 700;
      color: var(--psm-gold);
      min-width: 38px;
      text-align: center;
      font-size: 12px;
    }

    .psm-editor-save-btn {
      height: 28px;
      padding: 0 14px;
      background: linear-gradient(180deg, #5fe08a, #22c55e);
      border: 2px solid #ffffff;
      border-radius: 7px;
      color: #0b1838;
      font: 700 12.5px/1 var(--psm-font);
      cursor: pointer;
      box-shadow: 0 0 0 1px var(--psm-edge-out), 0 2px 6px rgba(0,0,0,.5);
      text-shadow: none;
      transition: filter .12s, transform .08s;
    }

    .psm-editor-save-btn:hover {
      filter: brightness(1.15);
    }

    .psm-editor-save-btn:active {
      transform: translateY(1px);
    }

    /* --------------------------------------------------------
       3. MODO TURBO GACHA Y TIRAR TODO (#scr-gacha y #pull-fx)
       -------------------------------------------------------- */
    .psm-turbo-toggle-wrap {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      user-select: none;
      font: 700 13px/1 var(--psm-font);
      color: var(--psm-muted);
      background: rgba(0, 0, 0, .35);
      border: 2px solid rgba(244, 248, 255, .22);
      border-radius: 20px;
      padding: 5px 11px;
      margin-left: auto;
      margin-right: 10px;
      text-shadow: 1.5px 1.5px 0 var(--psm-shadow);
      transition: all .18s ease;
      -webkit-font-smoothing: none;
    }

    .psm-turbo-toggle-wrap:hover {
      background: rgba(0, 0, 0, .5);
      border-color: rgba(255, 210, 63, .5);
      color: var(--psm-ink);
    }

    .psm-turbo-toggle-wrap.active {
      border-color: var(--psm-gold);
      background: rgba(255, 210, 63, .16);
      box-shadow: 0 0 10px rgba(255, 210, 63, .32);
      color: var(--psm-gold);
    }

    .psm-turbo-toggle-wrap input {
      display: none;
    }

    .psm-turbo-switch {
      position: relative;
      width: 30px;
      height: 16px;
      background: rgba(244, 248, 255, .18);
      border: 1.5px solid rgba(244, 248, 255, .35);
      border-radius: 10px;
      transition: all .18s ease;
      display: inline-block;
    }

    .psm-turbo-switch::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: #c9c1ad;
      transition: all .18s ease;
    }

    .psm-turbo-toggle-wrap.active .psm-turbo-switch {
      background: #2f9a52;
      border-color: var(--psm-gold);
    }

    .psm-turbo-toggle-wrap.active .psm-turbo-switch::after {
      transform: translateX(14px);
      background: var(--psm-gold);
      box-shadow: 0 0 5px #ffe9a0;
    }

    /* Aceleración fluida CSS del Modo Turbo Gacha sin bloquear ni mutar #pull-fx en bucles */
    html.psm-turbo-gacha-on #pull-fx,
    html.psm-turbo-gacha-on #pull-fx *,
    html.psm-turbo-gacha-on #slot,
    html.psm-turbo-gacha-on #pull-results .pcard {
      transition-duration: 0.05s !important;
      animation-duration: 0.05s !important;
      transition-delay: 0s !important;
      animation-delay: 0s !important;
    }

    html.psm-turbo-gacha-on #slot {
      opacity: 0.15;
      max-height: 36px;
      overflow: hidden;
      pointer-events: none;
      filter: blur(2px);
      margin-bottom: -24px;
    }

    @media(max-width:600px) {
      #psm-map-panel {
        bottom: 6px;
        right: 6px;
        transform: scale(.82);
        transform-origin: bottom right;
      }
      #psm-stats-panel {
        top: 60px;
        left: 6px;
        transform: scale(.82);
        transform-origin: top left;
      }
    }
  `;

  document.documentElement.appendChild(style);

  // ------------------------------------------------------------------
  // 1. PANEL MINIMAPA IN-GAME (ABAJO A LA DERECHA POR DEFECTO)
  // ------------------------------------------------------------------
  const mapPanel = document.createElement('section');
  mapPanel.id = 'psm-map-panel';

  const legendHTML = CATEGORIES.map(c => `
    <span class="psm-key ${visibility[c.id] ? '' : 'psm-off'}" data-cat="${c.id}" title="Clic para mostrar/ocultar">
      ${c.isBoss
        ? '<i class="psm-boss-diamond"></i>'
        : `<i class="psm-dot" style="background:${c.color}"></i>`}
      ${c.label}
    </span>
  `).join('');

  mapPanel.innerHTML = `
    <div id="psm-map-head" class="psm-panel-head" title="Arrastra para mover el Minimapa (doble clic para devolver abajo a la derecha)">
      <div class="psm-head-left">
        <span class="psm-head-title">🗺️ MAPA</span>
        <button id="psm-map-toggle-details" class="psm-map-filter-btn ${showMapDetails ? 'active' : ''}" type="button" title="Mostrar u ocultar leyenda y detalles del minimapa">🏷️ Filtros</button>
      </div>
      <div class="psm-head-actions">
        <span id="psm-fov-badge" class="psm-fov-badge" title="Zoom FOV de juego (Rueda ratón · Fin o clic para reset 1.0×)">FOV 1.0×</span>
        <span id="psm-passive-zoom" title="Zoom del minimapa">1.0×</span>
        <button id="psm-passive-out" class="psm-ctrl-btn" type="button" title="Alejar minimapa">−</button>
        <button id="psm-passive-in" class="psm-ctrl-btn" type="button" title="Acercar minimapa">+</button>
        <button id="psm-map-fold" class="psm-ctrl-btn" type="button" title="Plegar / desplegar Minimapa (Tecla B)">▁</button>
      </div>
    </div>

    <div id="psm-map-body">
      <div id="psm-map-wrap">
        <canvas id="psm-passive-map" width="256" height="256" aria-label="Minimapa de terreno explorado"></canvas>
        <button id="psm-recenter-btn" type="button" title="Volver a mi posición (o doble clic en el mapa)">⌖</button>
      </div>

      <div id="psm-map-details-wrap" ${showMapDetails ? '' : 'hidden'}>
        <div id="psm-passive-status">
          <span id="psm-status-left">Zonas: 0 · PDI: 0</span>
          <span id="psm-status-right" style="color:var(--psm-green);font-weight:700;"></span>
        </div>
        <div id="psm-passive-legend">${legendHTML}</div>
        <div id="psm-bottom-bar">
          <div id="psm-passive-help">B: plegar mapa · M: ocultar</div>
          <div id="psm-size-controls">
            <button id="psm-size-reset" type="button" title="Restablecer tamaño original"></button>
            <span id="psm-resize-grip" title="Arrastra para redimensionar">◢</span>
          </div>
        </div>
      </div>
    </div>
  `;
  if (!showMapDetails) mapPanel.classList.add('psm-clean-map');

  // ------------------------------------------------------------------
  // 2. PANEL DE DAÑO / STATS IN-GAME (ARRIBA A LA IZQUIERDA BAJO LA VIDA)
  // ------------------------------------------------------------------
  const statsPanel = document.createElement('section');
  statsPanel.id = 'psm-stats-panel';

  statsPanel.innerHTML = `
    <div id="psm-stats-head" class="psm-panel-head" title="Arrastra para mover el Panel de Daño (doble clic para devolver arriba a la izquierda bajo la vida)">
      <span class="psm-dmg-title">⚔️ DAÑO</span>
      <span id="psm-run-clock" class="psm-dmg-clock">0:00</span>
      <span id="psm-dps-live" class="psm-dmg-live-pill" title="DPS en tiempo real">0 DPS</span>
      <button id="psm-mejoras-btn" class="psm-mejoras-btn ${showBuffsPanel ? 'active' : ''}" type="button" title="Desplegar Tus Mejoras y Build (Alt + J)">Mejoras</button>
      <button id="psm-stats-fold" class="psm-ctrl-btn" type="button" title="Plegar / desplegar panel de daño (Tecla N)">▁</button>
    </div>

    <div id="psm-stats-body">
      <!-- Indicadores temporales: Siguiente nivel, Legendarios y Primera grieta posible -->
      <div id="psm-timers-info" class="psm-timers-box"></div>

      <!-- Tarjetas de daño por jugador (Tú + Aliados en Co-op con barra HP y desglose por movimiento) -->
      <div id="psm-player-rows" class="psm-player-rows"></div>

      <!-- Sección desplegable TUS MEJORAS + BUILD (solo visible al desplegar Mejoras) -->
      <div id="psm-expandable-section" ${showBuffsPanel ? '' : 'hidden'}>
        <div id="psm-buffs-panel" class="psm-buffs-box"></div>

        <div class="psm-stat-grid">
          <div class="psm-stat-card"><span>Mayor DPS</span><strong id="psm-st-maxdps" style="color:var(--psm-gold)">0</strong></div>
          <div class="psm-stat-card"><span>Golpe Máx</span><strong id="psm-st-max">0</strong></div>
          <div class="psm-stat-card"><span>Media / Hit</span><strong id="psm-st-avg">0</strong></div>
          <div class="psm-stat-card"><span>Hits Reales</span><strong id="psm-st-hits">0</strong></div>
        </div>

        <div class="psm-sec-title">
          <span id="psm-poke-header">Build</span>
          <span id="psm-lvl-badge" style="color:var(--psm-gold)">Nv. 1</span>
        </div>
        <div id="psm-passives-container" class="psm-upgrade-list"></div>
        <div id="psm-moves-container" class="psm-upgrade-list"></div>
      </div>
    </div>
  `;

  // ------------------------------------------------------------------
  // 3. BARRA DE VIDA Y WIDGET DE BUFOS PERSONALIZABLES
  // ------------------------------------------------------------------
  const hpBarEl = document.createElement('div');
  hpBarEl.id = 'psm-custom-hp-bar';
  hpBarEl.className = `psm-orient-${hpBarConfig.orientation} psm-theme-${hpBarConfig.theme === 'minimal' ? 'minimal' : 'classic'}`;
  hpBarEl.innerHTML = `
    <div class="psm-hp-edit-tag">✥ Arrastra vida</div>
    <div class="psm-hp-avatar-wrap">
      <span class="psm-hp-avatar" id="psm-hp-avatar-icon">⚡</span>
      <span class="psm-hp-badge" id="psm-hp-lvl-badge">Nv. 1</span>
    </div>
    <div class="psm-hp-main">
      <div class="psm-hp-header-line">
        <span class="psm-hp-name" id="psm-hp-player-name">Tú</span>
        <span class="psm-hp-val-top" id="psm-hp-val-top">PS: 100 / 100 (100%)</span>
      </div>
      <div class="psm-hp-track">
        <div class="psm-hp-fill ghost" id="psm-hp-ghost-fill" style="width:100%"></div>
        <div class="psm-hp-fill live" id="psm-hp-live-fill" style="width:100%"></div>
        <div class="psm-hp-fill shield" id="psm-hp-shield-fill" style="display:none;width:0%"></div>
        <div class="psm-hp-segments"></div>
        <div class="psm-hp-overlay-txt" id="psm-hp-overlay-txt">100%</div>
      </div>
      <div class="psm-hp-val-bottom" id="psm-hp-val-bottom">PS: 100 / 100</div>
    </div>
  `;

  const buffsBarEl = document.createElement('div');
  buffsBarEl.id = 'psm-custom-buffs-bar';
  buffsBarEl.className = 'psm-empty-buffs';
  buffsBarEl.innerHTML = `
    <div class="psm-hp-edit-tag">✥ Arrastra bufos</div>
    <div id="psm-buffs-pills-wrap"></div>
  `;

  const uiEditorOverlay = document.createElement('div');
  uiEditorOverlay.id = 'psm-ui-editor-overlay';
  uiEditorOverlay.innerHTML = `
    <div class="psm-editor-toolbar">
      <div class="psm-editor-title">
        <span>🛠️ EDITOR DE INTERFAZ IN-GAME</span>
        <span class="psm-editor-subtitle">Arrastra la barra de vida y los bufos a cualquier posición de la pantalla (Rueda para escalar)</span>
      </div>
      <div class="psm-editor-actions">
        <button id="psm-ui-theme-btn" class="psm-editor-tool-btn" type="button">🎨 Tema: ${hpBarConfig.theme === 'minimal' ? 'Minimalista Nativo' : 'Clásico PMD'}</button>
        <button id="psm-ui-orient-btn" class="psm-editor-tool-btn" type="button">🔄 Orientación: ${hpBarConfig.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'}</button>
        <div class="psm-editor-scale-ctrl">
          <span class="psm-scale-label">Vida:</span>
          <button id="psm-ui-scale-dec" class="psm-editor-tool-btn" type="button" style="height:22px;padding:0 6px;">−</button>
          <span id="psm-ui-scale-val" class="psm-scale-val">${Math.round(hpBarConfig.scale * 100)}%</span>
          <button id="psm-ui-scale-inc" class="psm-editor-tool-btn" type="button" style="height:22px;padding:0 6px;">+</button>
        </div>
        <div class="psm-editor-scale-ctrl">
          <span class="psm-scale-label">Bufos:</span>
          <button id="psm-ui-buffs-scale-dec" class="psm-editor-tool-btn" type="button" style="height:22px;padding:0 6px;">−</button>
          <span id="psm-ui-buffs-scale-val" class="psm-scale-val">${Math.round(buffsBarConfig.scale * 100)}%</span>
          <button id="psm-ui-buffs-scale-inc" class="psm-editor-tool-btn" type="button" style="height:22px;padding:0 6px;">+</button>
        </div>
        <button id="psm-ui-reset-btn" class="psm-editor-tool-btn" type="button">↺ Restablecer</button>
        <button id="psm-ui-save-btn" class="psm-editor-save-btn" type="button">✓ Guardar y Salir</button>
      </div>
    </div>
  `;

  // Montar directamente dentro del contenedor del juego para integración nativa in-game
  const gameContainer = gameCanvas.parentElement || document.body;
  gameContainer.appendChild(mapPanel);
  gameContainer.appendChild(statsPanel);
  gameContainer.appendChild(hpBarEl);
  gameContainer.appendChild(buffsBarEl);
  gameContainer.appendChild(uiEditorOverlay);

  // Evitar que clics o interacciones sobre los paneles se propaguen al canvas del juego
  const editorToolbar = uiEditorOverlay.querySelector('.psm-editor-toolbar');
  for (const evtName of ['mousedown', 'pointerdown', 'click', 'dblclick', 'contextmenu']) {
    mapPanel.addEventListener(evtName, e => e.stopPropagation());
    statsPanel.addEventListener(evtName, e => e.stopPropagation());
    hpBarEl.addEventListener(evtName, e => e.stopPropagation());
    buffsBarEl.addEventListener(evtName, e => e.stopPropagation());
    if (editorToolbar) editorToolbar.addEventListener(evtName, e => e.stopPropagation());
  }

  // ------------------------------------------------------------------
  // 2. MODAL NATIVO DE HISTORIAL + INYECCIÓN DE BOTONES EN LOBBY Y ESC
  // ------------------------------------------------------------------
  const historyModal = document.createElement('div');
  historyModal.id = 'psm-history-modal';
  historyModal.innerHTML = `
    <div class="psm-modal-box">
      <div class="psm-modal-header">
        <div class="psm-modal-title">
          <span>📜 HISTORIAL DE PARTIDAS</span>
          <span id="psm-hist-count" style="font-size:13px;color:var(--psm-muted);font-weight:700">0 runs</span>
        </div>
        <button id="psm-modal-close-btn" class="psm-modal-close" type="button">Cerrar (ESC)</button>
      </div>
      <div class="psm-modal-content">
        <div class="psm-sec-title" style="margin-bottom:6px">
          <span>🏆 Récords Personales</span>
        </div>
        <div class="psm-stat-grid-3">
          <div class="psm-stat-card"><span>Mejor Tiempo</span><strong id="psm-rec-time">--:--</strong></div>
          <div class="psm-stat-card"><span>Mayor DPS</span><strong id="psm-rec-dps" style="color:var(--psm-gold)">0</strong></div>
          <div class="psm-stat-card"><span>Más Kills</span><strong id="psm-rec-kills" style="color:var(--psm-green)">0</strong></div>
        </div>

        <div class="psm-sec-title" style="margin-bottom:6px">
          <span>Partidas Guardadas (Clic para ver Build y 📋 Compartir)</span>
        </div>
        <div id="psm-hist-list"></div>
      </div>
    </div>
  `;
  gameContainer.appendChild(historyModal);

  function openHistoryModal() {
    renderHistoryUI();
    historyModal.classList.add('open');
  }

  function closeHistoryModal() {
    historyModal.classList.remove('open');
  }

  historyModal.querySelector('#psm-modal-close-btn').addEventListener('click', closeHistoryModal);
  historyModal.addEventListener('click', e => {
    if (e.target === historyModal) closeHistoryModal();
  });

  // Inyecta el botón "Historial" en el Lobby (#scr-menu) y las 3 parejas horizontales en Pausa (#scr-pause)
  function ensureNativeHistoryButtons() {
    // A) LOBBY (#scr-menu) - Opción en la lista lateral nativa (.menu-list)
    const menuScr = document.getElementById('scr-menu');
    if (menuScr) {
      const menuList = menuScr.querySelector('.menu-list');
      if (menuList) {
        let lobbyHistBtn = document.getElementById('psm-lobby-hist-btn');
        if (!lobbyHistBtn) {
          lobbyHistBtn = document.createElement('button');
          lobbyHistBtn.id = 'psm-lobby-hist-btn';
          lobbyHistBtn.type = 'button';
          lobbyHistBtn.addEventListener('click', e => {
            e.stopPropagation();
            openHistoryModal();
          });
        }

        lobbyHistBtn.className = 'menu-item psm-lobby-hist-btn';
        lobbyHistBtn.setAttribute('data-go', 'history');

        const expectedLobbyHtml = `
          <span class="mi-ico">📜</span>
          <span class="mi-title">Historial</span>
          <small>Consulta tus runs anteriores y comparte tus builds</small>
        `.trim();

        if (lobbyHistBtn.innerHTML.replace(/\s+/g, ' ').trim() !== expectedLobbyHtml.replace(/\s+/g, ' ').trim()) {
          lobbyHistBtn.innerHTML = expectedLobbyHtml;
        }

        if (lobbyHistBtn.parentElement !== menuList) {
          const settingsBtn = menuList.querySelector('[data-go="settings"]') || menuList.lastElementChild;
          if (settingsBtn && settingsBtn.nextSibling) {
            menuList.insertBefore(lobbyHistBtn, settingsBtn.nextSibling);
          } else {
            menuList.appendChild(lobbyHistBtn);
          }
        }
      }
    }

    // B) MENÚ DE PAUSA IN-GAME (#scr-pause) - Distribución en 3 parejas horizontales al 50%
    const pauseScr = document.getElementById('scr-pause');
    if (pauseScr) {
      const pauseBox = pauseScr.querySelector('.box') || pauseScr;
      const pauseSound = pauseScr.querySelector('#pause-sound');

      // Fila 1: [ Silenciar todo ] y [ Modificar UI ]
      let row1 = document.getElementById('psm-pause-row-1');
      if (!row1) {
        row1 = document.createElement('div');
        row1.id = 'psm-pause-row-1';
        row1.className = 'row psm-pause-row';
      }

      let pauseEditUiBtn = document.getElementById('psm-pause-edit-ui-btn');
      if (!pauseEditUiBtn) {
        pauseEditUiBtn = document.createElement('button');
        pauseEditUiBtn.id = 'psm-pause-edit-ui-btn';
        pauseEditUiBtn.type = 'button';
        pauseEditUiBtn.className = 'btn psm-pause-btn';
        pauseEditUiBtn.innerHTML = '<span class="psm-btn-ico">🛠️</span><span>Modificar UI</span>';
        pauseEditUiBtn.addEventListener('click', e => {
          e.stopPropagation();
          openUiEditor();
        });
      }

      // Reubicar botón nativo de mute (Silenciar todo / Activar sonido) dentro de row1
      const muteBtn = pauseScr.querySelector('button[data-mute]');
      if (muteBtn && muteBtn.parentElement !== row1) {
        const oldMute = row1.querySelector('button[data-mute]');
        if (oldMute && oldMute !== muteBtn) oldMute.remove();
        muteBtn.classList.add('btn', 'psm-pause-btn');
        row1.insertBefore(muteBtn, pauseEditUiBtn);
      }
      if (pauseEditUiBtn.parentElement !== row1) {
        row1.appendChild(pauseEditUiBtn);
      }

      // Fila 2: [ Continuar ] y [ Ajustes ] (fila nativa)
      let row2 = document.getElementById('psm-pause-row-2');
      const resumeBtn = document.getElementById('btn-resume') || Array.from(pauseScr.querySelectorAll('button')).find(b => /continuar|reanudar/i.test(b.textContent || ''));
      const settingsBtn = document.getElementById('btn-pause-settings') || Array.from(pauseScr.querySelectorAll('button')).find(b => b.id !== 'psm-pause-edit-ui-btn' && /ajustes|settings/i.test(b.textContent || ''));

      if (!row2) {
        const existingRow = resumeBtn ? resumeBtn.closest('.row') : null;
        if (existingRow && existingRow !== row1) {
          row2 = existingRow;
        } else {
          row2 = document.createElement('div');
        }
        row2.id = 'psm-pause-row-2';
      }
      row2.className = 'row psm-pause-row';

      if (resumeBtn && resumeBtn.parentElement !== row2) {
        row2.appendChild(resumeBtn);
      }
      if (settingsBtn && settingsBtn.parentElement !== row2) {
        row2.appendChild(settingsBtn);
      }
      if (resumeBtn) resumeBtn.classList.add('btn', 'psm-pause-btn');
      if (settingsBtn) settingsBtn.classList.add('btn', 'psm-pause-btn');

      // Fila 3: [ Historial ] y [ Abandonar run ]
      let row3 = document.getElementById('psm-pause-row-3');
      if (!row3) {
        row3 = document.createElement('div');
        row3.id = 'psm-pause-row-3';
        row3.className = 'row psm-pause-row';
      }

      let pauseHistBtn = document.getElementById('psm-pause-hist-btn');
      if (!pauseHistBtn) {
        pauseHistBtn = document.createElement('button');
        pauseHistBtn.id = 'psm-pause-hist-btn';
        pauseHistBtn.type = 'button';
        pauseHistBtn.className = 'btn psm-pause-btn';
        pauseHistBtn.innerHTML = '<span class="psm-btn-ico">📜</span><span>Historial</span>';
        pauseHistBtn.addEventListener('click', e => {
          e.stopPropagation();
          openHistoryModal();
        });
      }

      const quitBtn = document.getElementById('btn-quit') || Array.from(pauseScr.querySelectorAll('button')).find(b => b.id !== 'psm-pause-hist-btn' && /abandonar|salir/i.test(b.textContent || ''));

      if (pauseHistBtn.parentElement !== row3) {
        row3.appendChild(pauseHistBtn);
      }
      if (quitBtn && quitBtn.parentElement !== row3) {
        row3.appendChild(quitBtn);
      }
      if (quitBtn) quitBtn.classList.add('btn', 'psm-pause-btn');

      // Orden estricto en el DOM: #pause-sound -> row1 -> row2 -> row3
      if (pauseSound && pauseSound.parentElement === pauseBox) {
        if (row1.parentElement !== pauseBox || row1.previousElementSibling !== pauseSound) {
          pauseSound.insertAdjacentElement('afterend', row1);
        }
      } else if (row1.parentElement !== pauseBox) {
        pauseBox.appendChild(row1);
      }

      if (row2.parentElement !== pauseBox || row2.previousElementSibling !== row1) {
        row1.insertAdjacentElement('afterend', row2);
      }

      if (row3.parentElement !== pauseBox || row3.previousElementSibling !== row2) {
        row2.insertAdjacentElement('afterend', row3);
      }

      // Observer en #pause-sound para que cualquier redibujado nativo de sonido mueva el botón data-mute a row1
      if (pauseSound && !pauseSound._psmObserved) {
        pauseSound._psmObserved = true;
        const soundObs = new MutationObserver(() => {
          const freshMute = pauseSound.querySelector('button[data-mute]');
          if (freshMute && freshMute.parentElement !== row1) {
            const oldMute = row1.querySelector('button[data-mute]');
            if (oldMute && oldMute !== freshMute) oldMute.remove();
            freshMute.classList.add('btn', 'psm-pause-btn');
            row1.insertBefore(freshMute, pauseEditUiBtn);
          }
        });
        soundObs.observe(pauseSound, { childList: true, subtree: true });
      }
    }
  }

  // ------------------------------------------------------------------
  // SISTEMA SEGURO DE MODO TURBO GACHA + BOTÓN "TIRAR TODO" (v3.4)
  // ------------------------------------------------------------------
  function isGachaPullActive() {
    const pullFx = document.getElementById('pull-fx');
    return (turboGachaEnabled || revealBudget !== null) && pullFx && !pullFx.classList.contains('hidden');
  }

  // Acelerar únicamente la pausa de revelado de cartas (150ms -> 10ms) cuando #pull-fx está abierto,
  // sin alterar performance.now ni observar mutaciones de clase en #pull-fx
  window.setTimeout = function(callback, delay, ...args) {
    if (isGachaPullActive() && typeof delay === 'number' && delay >= 40) {
      delay = Math.max(8, Math.round(delay / 15));
    }
    return origSetTimeout(callback, delay, ...args);
  };

  // Fallback seguro sobre #slot.onclick por si la extensión se recargó sin refrescar la pestaña
  function hookSlotCanvasFallback() {
    const slotCanvas = document.getElementById('slot');
    if (!slotCanvas || slotCanvas.__psmOnClickHooked) return;
    slotCanvas.__psmOnClickHooked = true;

    let currentOnClick = slotCanvas.onclick;
    try {
      Object.defineProperty(slotCanvas, 'onclick', {
        configurable: true,
        enumerable: true,
        get() {
          return currentOnClick;
        },
        set(fn) {
          currentOnClick = fn;
          if (typeof fn === 'function' && (turboGachaEnabled || forceSkipSlot)) {
            forceSkipSlot = false;
            origSetTimeout(() => {
              if (currentOnClick === fn) {
                try { fn(); } catch (_) {}
              }
            }, 0);
          }
        }
      });
    } catch (_) {}
  }

  function refreshPullAllButton() {
    const pullAllBtn = document.getElementById('psm-pull-all-btn') || document.getElementById('psmod-pull-all');
    if (!pullAllBtn) return;
    const n = pullsAvailableCount();
    const label = `Tirar todo · ${n}`;
    if (pullAllBtn.textContent !== label) pullAllBtn.textContent = label;
    const isDis = n <= 0;
    if (pullAllBtn.disabled !== isDis) pullAllBtn.disabled = isDis;
  }

  function ensureNativeGachaToggle() {
    hookSlotCanvasFallback();
    const gachaScr = document.getElementById('scr-gacha');
    if (!gachaScr) return;

    // 1. Toggle de Modo Turbo en la cabecera de Gacha
    const titleRow = gachaScr.querySelector('.row.between');
    if (titleRow && !document.getElementById('psm-turbo-toggle-wrap')) {
      const toggleWrap = document.createElement('label');
      toggleWrap.id = 'psm-turbo-toggle-wrap';
      toggleWrap.className = `psm-turbo-toggle-wrap ${turboGachaEnabled ? 'active' : ''}`;
      toggleWrap.title = 'Modo Turbo: omite la tragaperras (Slots.play) y acelera el revelado de tiradas ×1, ×10 y Tirar todo';
      toggleWrap.innerHTML = `
        <span class="psm-turbo-label">⚡ Modo Turbo</span>
        <input type="checkbox" id="psm-turbo-checkbox" ${turboGachaEnabled ? 'checked' : ''}>
        <span class="psm-turbo-switch"></span>
      `;

      const checkbox = toggleWrap.querySelector('#psm-turbo-checkbox');
      checkbox.addEventListener('change', () => {
        turboGachaEnabled = checkbox.checked;
        try {
          localStorage.setItem(TURBO_GACHA_KEY, String(turboGachaEnabled));
        } catch (_) {}
        toggleWrap.classList.toggle('active', turboGachaEnabled);
        document.documentElement.classList.toggle('psm-turbo-gacha-on', turboGachaEnabled);

        if (turboGachaEnabled) {
          const slotCanvas = document.getElementById('slot');
          if (slotCanvas && typeof slotCanvas.onclick === 'function') {
            try { slotCanvas.onclick(); } catch (_) {}
          }
        }
      });

      const backBtn = titleRow.querySelector('[data-back]');
      if (backBtn) {
        titleRow.insertBefore(toggleWrap, backBtn);
      } else {
        titleRow.appendChild(toggleWrap);
      }
    }

    // 2. Botón "Tirar todo · N" junto a los botones de tirada (#pull-1, #pull-10)
    const pullOneBtn = document.getElementById('pull-1');
    if (
      pullOneBtn &&
      pullOneBtn.parentElement &&
      !document.getElementById('psm-pull-all-btn') &&
      !document.getElementById('psmod-pull-all')
    ) {
      const pullAllBtn = document.createElement('button');
      pullAllBtn.id = 'psm-pull-all-btn';
      pullAllBtn.className = 'btn grow';
      pullAllBtn.type = 'button';
      pullAllBtn.dataset.sfx = 'none';
      pullAllBtn.title = 'Gasta todos los tickets acumulados de golpe (primero tickets ×10, luego lotes de 10 y finalmente sueltos)';
      pullOneBtn.parentElement.appendChild(pullAllBtn);

      pullAllBtn.addEventListener('click', e => {
        e.stopPropagation();
        const totalPulls = pullsAvailableCount();
        if (totalPulls <= 0 || typeof pullOneBtn.onclick !== 'function') return;

        pullAllArmed = true;
        if (turboGachaEnabled) {
          forceSkipSlot = true;
        }
        revealBudget = 1;

        try {
          pullOneBtn.onclick();
        } finally {
          pullAllArmed = false;
          forceSkipSlot = false;
          origSetTimeout(() => {
            revealBudget = null;
          }, 4000);
          refreshPullAllButton();
          pullAllBtn.blur();
        }
      });

      refreshPullAllButton();
    } else {
      refreshPullAllButton();
    }
  }

  // Ejecutar al inicio; el bucle ligero de 220ms se encarga de verificar e inyectar sin necesitar un MutationObserver global
  ensureNativeHistoryButtons();
  ensureNativeGachaToggle();

  // Referencias del HUD (Minimapa y Panel de Daño) y del Modal
  const mapWrap = mapPanel.querySelector('#psm-map-wrap');
  const mapCanvas = mapPanel.querySelector('#psm-passive-map');
  const mapCtx = mapCanvas.getContext('2d');
  const recenterBtn = mapPanel.querySelector('#psm-recenter-btn');
  const statusLeft = mapPanel.querySelector('#psm-status-left');
  const statusRight = mapPanel.querySelector('#psm-status-right');
  const zoomLabel = mapPanel.querySelector('#psm-passive-zoom');
  const fovBadge = mapPanel.querySelector('#psm-fov-badge');
  const mapHead = mapPanel.querySelector('#psm-map-head');
  const mapFoldBtn = mapPanel.querySelector('#psm-map-fold');
  const mapFilterBtn = mapPanel.querySelector('#psm-map-toggle-details');
  const mapDetailsWrap = mapPanel.querySelector('#psm-map-details-wrap');
  const legendEl = mapPanel.querySelector('#psm-passive-legend');
  const sizeResetBtn = mapPanel.querySelector('#psm-size-reset');
  const resizeGrip = mapPanel.querySelector('#psm-resize-grip');

  function toggleMapDetails() {
    showMapDetails = !showMapDetails;
    try {
      localStorage.setItem(MAP_DETAILS_KEY, String(showMapDetails));
    } catch (_) {}
    if (mapFilterBtn) mapFilterBtn.classList.toggle('active', showMapDetails);
    if (mapDetailsWrap) mapDetailsWrap.hidden = !showMapDetails;
    mapPanel.classList.toggle('psm-clean-map', !showMapDetails);
    clampMapPanelToViewport();
  }

  if (mapFilterBtn) {
    mapFilterBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleMapDetails();
    });
  }

  // ------------------------------------------------------------------
  // CONTROL Y LÓGICA DEL EDITOR DE UI + BARRA DE VIDA Y WIDGET DE BUFOS
  // ------------------------------------------------------------------
  let wasPauseHiddenForEdit = false;
  const buffMaxDurMap = new Map();
  const canvasCapturedBuffs = new Map();
  let lastRenderedBuffsSig = '';

  const BUFF_META = {
    atk: { label: 'ATK', icon: '⚔️', color: '#ff6b4d' },
    patk: { label: 'ATK', icon: '⚔️', color: '#ff6b4d' },
    satk: { label: 'AT.E', icon: '✨', color: '#c47bff' },
    spd: { label: 'VEL', icon: '⚡', color: '#7fe0ff' },
    def: { label: 'DEF', icon: '🛡️', color: '#b0b8c8' },
    regen: { label: 'REG', icon: '💚', color: '#5fe08a' },
    xpmagnet: { label: 'IMÁN XP', icon: '🧲', color: '#a855f7' },
    frenzy: { label: 'FRENESÍ', icon: '💢', color: '#ff5f6d' },
    CritBoost: { label: 'CRÍT+', icon: '🎯', color: '#ffd23f' },
    Haste: { label: 'PRISA', icon: '💨', color: '#67e8f9' }
  };

  function openUiEditor() {
    const pauseScr = document.getElementById('scr-pause');
    if (pauseScr && !pauseScr.classList.contains('hidden') && pauseScr.style.display !== 'none' && pauseScr.style.visibility !== 'hidden') {
      wasPauseHiddenForEdit = true;
      pauseScr.style.visibility = 'hidden';
    } else {
      wasPauseHiddenForEdit = false;
    }

    isEditingUI = true;
    uiEditorOverlay.classList.add('open');
    hpBarEl.classList.remove('psm-modal-dimmed');
    hpBarEl.classList.add('psm-editing-ui');
    if (buffsBarEl) {
      buffsBarEl.classList.remove('psm-modal-dimmed');
      buffsBarEl.classList.add('psm-editing-ui');
    }
    applyHpBarConfig();
    applyBuffsBarConfig();
    updateCustomHpBar(true);
    updateCustomBuffsBar(true);
  }

  function closeUiEditor(save = true) {
    if (isDraggingHpBar) {
      isDraggingHpBar = false;
      hpBarEl.classList.remove('psm-dragging');
    }
    if (isDraggingBuffsBar && buffsBarEl) {
      isDraggingBuffsBar = false;
      buffsBarEl.classList.remove('psm-dragging');
    }
    if (save) {
      saveHpBarConfig();
      saveBuffsBarConfig();
    }
    isEditingUI = false;
    uiEditorOverlay.classList.remove('open');
    hpBarEl.classList.remove('psm-editing-ui');
    if (buffsBarEl) {
      buffsBarEl.classList.remove('psm-editing-ui');
    }

    if (wasPauseHiddenForEdit) {
      const pauseScr = document.getElementById('scr-pause');
      if (pauseScr) pauseScr.style.visibility = '';
      wasPauseHiddenForEdit = false;
    }

    updateHudVisibility();
  }

  function saveHpBarConfig() {
    try {
      const jsonStr = JSON.stringify(hpBarConfig);
      localStorage.setItem(HP_CONFIG_KEY, jsonStr);
      localStorage.setItem(HP_CONFIG_FALLBACK_KEY, jsonStr);
    } catch (_) {}
  }

  function saveBuffsBarConfig() {
    try {
      localStorage.setItem(BUFFS_CONFIG_KEY, JSON.stringify(buffsBarConfig));
    } catch (_) {}
  }

  function clampHpBarToViewport() {
    if (!hpBarEl) return;
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 600;
    const rect = hpBarEl.getBoundingClientRect();
    const w = (rect.width > 0) ? rect.width : (hpBarConfig.orientation === 'vertical' ? 58 : 265) * hpBarConfig.scale;
    const h = (rect.height > 0) ? rect.height : (hpBarConfig.orientation === 'vertical' ? 190 : 54) * hpBarConfig.scale;

    const maxX = Math.max(0, vw - w);
    const maxY = Math.max(0, vh - h);

    hpBarConfig.x = Math.max(0, Math.min(maxX, hpBarConfig.x));
    hpBarConfig.y = Math.max(0, Math.min(maxY, hpBarConfig.y));

    hpBarEl.style.setProperty('position', 'fixed', 'important');
    hpBarEl.style.setProperty('left', `${Math.round(hpBarConfig.x)}px`, 'important');
    hpBarEl.style.setProperty('top', `${Math.round(hpBarConfig.y)}px`, 'important');
  }

  function clampBuffsBarToViewport() {
    if (!buffsBarEl) return;
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 600;
    const rect = buffsBarEl.getBoundingClientRect();
    const w = (rect.width > 0) ? rect.width : 160 * buffsBarConfig.scale;
    const h = (rect.height > 0) ? rect.height : 28 * buffsBarConfig.scale;

    const maxX = Math.max(0, vw - w);
    const maxY = Math.max(0, vh - h);

    buffsBarConfig.x = Math.max(0, Math.min(maxX, buffsBarConfig.x));
    buffsBarConfig.y = Math.max(0, Math.min(maxY, buffsBarConfig.y));

    buffsBarEl.style.setProperty('position', 'fixed', 'important');
    buffsBarEl.style.setProperty('left', `${Math.round(buffsBarConfig.x)}px`, 'important');
    buffsBarEl.style.setProperty('top', `${Math.round(buffsBarConfig.y)}px`, 'important');
  }

  function applyHpBarConfig() {
    if (!hpBarEl) return;
    const isMinimal = hpBarConfig.theme === 'minimal';
    hpBarEl.classList.remove('psm-orient-horizontal', 'psm-orient-vertical', 'psm-theme-classic', 'psm-theme-minimal');
    hpBarEl.classList.add(`psm-orient-${hpBarConfig.orientation}`, isMinimal ? 'psm-theme-minimal' : 'psm-theme-classic');

    hpBarEl.style.setProperty('position', 'fixed', 'important');
    hpBarEl.style.setProperty('left', `${Math.round(hpBarConfig.x)}px`, 'important');
    hpBarEl.style.setProperty('top', `${Math.round(hpBarConfig.y)}px`, 'important');
    hpBarEl.style.setProperty('transform', `scale(${hpBarConfig.scale})`, 'important');
    hpBarEl.style.setProperty('transform-origin', 'top left', 'important');

    clampHpBarToViewport();

    const scaleValEl = uiEditorOverlay.querySelector('#psm-ui-scale-val');
    if (scaleValEl) {
      scaleValEl.textContent = `${Math.round(hpBarConfig.scale * 100)}%`;
    }
    const orientBtn = uiEditorOverlay.querySelector('#psm-ui-orient-btn');
    if (orientBtn) {
      orientBtn.textContent = `🔄 Orientación: ${hpBarConfig.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'}`;
    }
    const themeBtn = uiEditorOverlay.querySelector('#psm-ui-theme-btn');
    if (themeBtn) {
      themeBtn.textContent = `🎨 Tema: ${isMinimal ? 'Minimalista Nativo' : 'Clásico PMD'}`;
    }
  }

  function applyBuffsBarConfig() {
    if (!buffsBarEl) return;
    buffsBarEl.style.setProperty('position', 'fixed', 'important');
    buffsBarEl.style.setProperty('left', `${Math.round(buffsBarConfig.x)}px`, 'important');
    buffsBarEl.style.setProperty('top', `${Math.round(buffsBarConfig.y)}px`, 'important');
    buffsBarEl.style.setProperty('transform', `scale(${buffsBarConfig.scale})`, 'important');
    buffsBarEl.style.setProperty('transform-origin', 'top left', 'important');

    clampBuffsBarToViewport();

    const buffsScaleValEl = uiEditorOverlay.querySelector('#psm-ui-buffs-scale-val');
    if (buffsScaleValEl) {
      buffsScaleValEl.textContent = `${Math.round(buffsBarConfig.scale * 100)}%`;
    }
  }

  let isDraggingHpBar = false;
  let hpDragOffsetX = 0;
  let hpDragOffsetY = 0;

  let isDraggingBuffsBar = false;
  let buffsDragOffsetX = 0;
  let buffsDragOffsetY = 0;

  hpBarEl.addEventListener('pointerdown', e => {
    if (!isEditingUI) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingHpBar = true;
    hpBarEl.classList.add('psm-dragging');

    const rect = hpBarEl.getBoundingClientRect();
    hpDragOffsetX = e.clientX - rect.left;
    hpDragOffsetY = e.clientY - rect.top;

    try {
      hpBarEl.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  buffsBarEl.addEventListener('pointerdown', e => {
    if (!isEditingUI) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingBuffsBar = true;
    buffsBarEl.classList.add('psm-dragging');

    const rect = buffsBarEl.getBoundingClientRect();
    buffsDragOffsetX = e.clientX - rect.left;
    buffsDragOffsetY = e.clientY - rect.top;

    try {
      buffsBarEl.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  hpBarEl.addEventListener('wheel', e => {
    if (!isEditingUI) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.1 : -0.1;
    hpBarConfig.scale = Math.max(0.6, Math.min(2.0, Math.round((hpBarConfig.scale + step) * 10) / 10));
    applyHpBarConfig();
    saveHpBarConfig();
  }, { passive: false });

  buffsBarEl.addEventListener('wheel', e => {
    if (!isEditingUI) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.deltaY < 0 ? 0.1 : -0.1;
    buffsBarConfig.scale = Math.max(0.6, Math.min(2.0, Math.round((buffsBarConfig.scale + step) * 10) / 10));
    applyBuffsBarConfig();
    saveBuffsBarConfig();
  }, { passive: false });

  function onHpBarPointerMove(e) {
    if (isDraggingHpBar && isEditingUI) {
      e.preventDefault();
      e.stopPropagation();
      hpBarConfig.x = e.clientX - hpDragOffsetX;
      hpBarConfig.y = e.clientY - hpDragOffsetY;
      clampHpBarToViewport();
      return;
    }
    if (isDraggingBuffsBar && isEditingUI) {
      e.preventDefault();
      e.stopPropagation();
      buffsBarConfig.x = e.clientX - buffsDragOffsetX;
      buffsBarConfig.y = e.clientY - buffsDragOffsetY;
      clampBuffsBarToViewport();
    }
  }

  function onHpBarPointerUp(e) {
    if (isDraggingHpBar) {
      isDraggingHpBar = false;
      hpBarEl.classList.remove('psm-dragging');
      try {
        if (e && e.pointerId !== undefined && hpBarEl.hasPointerCapture && hpBarEl.hasPointerCapture(e.pointerId)) {
          hpBarEl.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      clampHpBarToViewport();
      saveHpBarConfig();
    }
    if (isDraggingBuffsBar) {
      isDraggingBuffsBar = false;
      buffsBarEl.classList.remove('psm-dragging');
      try {
        if (e && e.pointerId !== undefined && buffsBarEl.hasPointerCapture && buffsBarEl.hasPointerCapture(e.pointerId)) {
          buffsBarEl.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      clampBuffsBarToViewport();
      saveBuffsBarConfig();
    }
  }

  hpBarEl.addEventListener('pointermove', onHpBarPointerMove);
  hpBarEl.addEventListener('pointerup', onHpBarPointerUp);
  hpBarEl.addEventListener('pointercancel', onHpBarPointerUp);

  buffsBarEl.addEventListener('pointermove', onHpBarPointerMove);
  buffsBarEl.addEventListener('pointerup', onHpBarPointerUp);
  buffsBarEl.addEventListener('pointercancel', onHpBarPointerUp);

  window.addEventListener('pointermove', onHpBarPointerMove, { passive: false });
  window.addEventListener('pointerup', onHpBarPointerUp, { passive: false });
  window.addEventListener('pointercancel', onHpBarPointerUp, { passive: false });

  // Botones de la barra del editor
  const uiThemeBtn = uiEditorOverlay.querySelector('#psm-ui-theme-btn');
  const uiOrientBtn = uiEditorOverlay.querySelector('#psm-ui-orient-btn');
  const uiScaleDecBtn = uiEditorOverlay.querySelector('#psm-ui-scale-dec');
  const uiScaleIncBtn = uiEditorOverlay.querySelector('#psm-ui-scale-inc');
  const uiBuffsScaleDecBtn = uiEditorOverlay.querySelector('#psm-ui-buffs-scale-dec');
  const uiBuffsScaleIncBtn = uiEditorOverlay.querySelector('#psm-ui-buffs-scale-inc');
  const uiResetBtn = uiEditorOverlay.querySelector('#psm-ui-reset-btn');
  const uiSaveBtn = uiEditorOverlay.querySelector('#psm-ui-save-btn');

  if (uiThemeBtn) {
    uiThemeBtn.addEventListener('click', e => {
      e.stopPropagation();
      hpBarConfig.theme = hpBarConfig.theme === 'minimal' ? 'classic' : 'minimal';
      applyHpBarConfig();
      updateCustomHpBar(true);
      saveHpBarConfig();
    });
  }

  if (uiOrientBtn) {
    uiOrientBtn.addEventListener('click', e => {
      e.stopPropagation();
      hpBarConfig.orientation = hpBarConfig.orientation === 'horizontal' ? 'vertical' : 'horizontal';
      applyHpBarConfig();
      updateCustomHpBar(true);
      saveHpBarConfig();
    });
  }

  if (uiScaleDecBtn) {
    uiScaleDecBtn.addEventListener('click', e => {
      e.stopPropagation();
      hpBarConfig.scale = Math.max(0.6, Math.round((hpBarConfig.scale - 0.1) * 10) / 10);
      applyHpBarConfig();
      saveHpBarConfig();
    });
  }

  if (uiScaleIncBtn) {
    uiScaleIncBtn.addEventListener('click', e => {
      e.stopPropagation();
      hpBarConfig.scale = Math.min(2.0, Math.round((hpBarConfig.scale + 0.1) * 10) / 10);
      applyHpBarConfig();
      saveHpBarConfig();
    });
  }

  if (uiBuffsScaleDecBtn) {
    uiBuffsScaleDecBtn.addEventListener('click', e => {
      e.stopPropagation();
      buffsBarConfig.scale = Math.max(0.6, Math.round((buffsBarConfig.scale - 0.1) * 10) / 10);
      applyBuffsBarConfig();
      saveBuffsBarConfig();
    });
  }

  if (uiBuffsScaleIncBtn) {
    uiBuffsScaleIncBtn.addEventListener('click', e => {
      e.stopPropagation();
      buffsBarConfig.scale = Math.min(2.0, Math.round((buffsBarConfig.scale + 0.1) * 10) / 10);
      applyBuffsBarConfig();
      saveBuffsBarConfig();
    });
  }

  if (uiResetBtn) {
    uiResetBtn.addEventListener('click', e => {
      e.stopPropagation();
      hpBarConfig = { ...DEFAULT_HP_CONFIG };
      buffsBarConfig = { ...DEFAULT_BUFFS_CONFIG };
      applyHpBarConfig();
      applyBuffsBarConfig();
      updateCustomHpBar(true);
      updateCustomBuffsBar(true);
      saveHpBarConfig();
      saveBuffsBarConfig();
    });
  }

  if (uiSaveBtn) {
    uiSaveBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeUiEditor(true);
    });
  }

  function collectActivePlayerBuffs() {
    const items = [];
    const seenLabels = new Set();
    const engPl = getEngineLocalPlayer();

    if (engPl && engPl.buffs && typeof engPl.buffs === 'object') {
      for (const k of Object.keys(engPl.buffs)) {
        const b = engPl.buffs[k];
        const meta = BUFF_META[k] || { label: k.toUpperCase(), icon: '⚡', color: '#7fe0ff' };
        if (b && typeof b === 'object') {
          const n = b.n || 0;
          const t = typeof b.t === 'number' ? b.t : 0;
          if (n > 0) {
            const prevMax = buffMaxDurMap.get(k) || 0;
            const maxT = Math.max(prevMax, t, 1);
            buffMaxDurMap.set(k, maxT);
            const pct = t > 0 ? Math.max(5, Math.min(100, Math.round((t / maxT) * 100))) : 100;
            const labelTxt = `${meta.label} ×${n}`;
            seenLabels.add(meta.label.toUpperCase());
            items.push({
              key: k,
              icon: meta.icon,
              label: labelTxt,
              timeStr: t > 0 ? `${Math.ceil(t)}s` : '',
              pct,
              color: meta.color
            });
          } else {
            buffMaxDurMap.delete(k);
          }
        } else if (typeof b === 'number' && b > 0) {
          const prevMax = buffMaxDurMap.get(k) || 0;
          const maxT = Math.max(prevMax, b, 1);
          buffMaxDurMap.set(k, maxT);
          const pct = Math.max(5, Math.min(100, Math.round((b / maxT) * 100)));
          seenLabels.add(meta.label.toUpperCase());
          items.push({
            key: k,
            icon: meta.icon,
            label: meta.label,
            timeStr: `${Math.ceil(b)}s`,
            pct,
            color: meta.color
          });
        }
      }
    }

    if (engPl && engPl.power && typeof engPl.power === 'object' && engPl.power.t > 0) {
      const p = engPl.power;
      const pName = (p.def && p.def.name) ? String(p.def.name).toUpperCase() : 'PODER';
      const pCol = (p.def && p.def.color) || '#ffd23f';
      const maxDur = Math.max(p.dur || 0, buffMaxDurMap.get('__power') || 0, p.t, 1);
      buffMaxDurMap.set('__power', maxDur);
      const pct = Math.max(5, Math.min(100, Math.round((p.t / maxDur) * 100)));
      seenLabels.add(pName);
      items.push({
        key: '__power',
        icon: '🌟',
        label: pName,
        timeStr: `${Math.ceil(p.t)}s`,
        pct,
        color: pCol
      });
    } else {
      buffMaxDurMap.delete('__power');
    }

    if (engPl && typeof engPl.slowT === 'number' && engPl.slowT > 0) {
      const maxSlow = Math.max(buffMaxDurMap.get('__slow') || 0, engPl.slowT, 1);
      buffMaxDurMap.set('__slow', maxSlow);
      const pct = Math.max(5, Math.min(100, Math.round((engPl.slowT / maxSlow) * 100)));
      items.push({
        key: '__slow',
        icon: '❄️',
        label: 'LENTO',
        timeStr: `${Math.ceil(engPl.slowT)}s`,
        pct,
        color: '#60a5fa'
      });
    } else {
      buffMaxDurMap.delete('__slow');
    }

    // Fallback por intercepción de textos de bufos en el Canvas
    const nowPerf = performance.now();
    for (const [capKey, cap] of canvasCapturedBuffs.entries()) {
      if (nowPerf - cap.seenAt > 450) {
        canvasCapturedBuffs.delete(capKey);
        continue;
      }
      if (seenLabels.has(cap.prefix)) continue;
      items.push({
        key: `cap_${capKey}`,
        icon: cap.icon || '⚡',
        label: cap.label,
        timeStr: cap.timeStr || '',
        pct: 100,
        color: cap.color || '#7fe0ff'
      });
    }

    if (isEditingUI && items.length === 0) {
      return [
        { key: 'sample_spd', icon: '⚡', label: 'VEL ×1', timeStr: '5s', pct: 78, color: '#7fe0ff' },
        { key: 'sample_atk', icon: '⚔️', label: 'ATK ×2', timeStr: '4s', pct: 62, color: '#ff6b4d' },
        { key: 'sample_def', icon: '🛡️', label: 'DEF ×1', timeStr: '6s', pct: 85, color: '#b0b8c8' }
      ];
    }

    return items;
  }

  function updateCustomBuffsBar(forceRender = false) {
    if (!buffsBarEl) return;
    if (!activeRun && !isEditingUI) {
      buffsBarEl.classList.add('psm-empty-buffs');
      return;
    }

    const wrap = buffsBarEl.querySelector('#psm-buffs-pills-wrap');
    if (!wrap) return;

    const items = collectActivePlayerBuffs();
    buffsBarEl.classList.toggle('psm-empty-buffs', items.length === 0 && !isEditingUI);

    const sig = items.map(it => `${it.key}:${it.label}:${it.timeStr}:${it.pct}:${it.color}`).join('|');
    if (!forceRender && sig === lastRenderedBuffsSig) return;
    lastRenderedBuffsSig = sig;

    if (items.length === 0) {
      wrap.innerHTML = '';
      return;
    }

    wrap.innerHTML = items.map(it => `
      <div class="psm-buff-pill" style="--psm-buff-col:${escapeHtml(it.color)}">
        <span class="psm-buff-ico">${it.icon}</span>
        <span class="psm-buff-label">${escapeHtml(it.label)}</span>
        ${it.timeStr ? `<span class="psm-buff-timer">${escapeHtml(it.timeStr)}</span>` : ''}
        <span class="psm-buff-prog"><i style="width:${it.pct}%"></i></span>
      </div>
    `).join('');
  }

  function updateCustomHpBar(forceSample = false) {
    if (!hpBarEl) return;
    if (!activeRun && !isEditingUI) {
      return;
    }

    let curHp = 100;
    let maxHp = 100;
    let shieldVal = 0;
    let pName = companionName || localPlayerNick || 'Tú';
    let pLvl = currentLevel || 1;
    let pDex = null;

    const engPl = getEngineLocalPlayer();
    if (engPl) {
      if (typeof engPl.hp === 'number') curHp = Math.max(0, engPl.hp);
      if (typeof engPl.maxHp === 'number' && engPl.maxHp > 0) maxHp = engPl.maxHp;
      if (typeof engPl.shield === 'number' && engPl.shield > 0) shieldVal = engPl.shield;
      if (engPl.level && engPl.level > 0) pLvl = engPl.level;
      if (engPl.mon && engPl.mon.name) pName = engPl.mon.name;
      else if (companionName) pName = companionName;
      if (typeof engPl.dex === 'number' && engPl.dex > 0) pDex = engPl.dex;
      else if (engPl.mon && typeof engPl.mon.dex === 'number' && engPl.mon.dex > 0) pDex = engPl.mon.dex;
    }

    if (isEditingUI && !activeRun) {
      curHp = 85;
      maxHp = 100;
      pLvl = 5;
      pName = companionName || 'Pikachu';
      pDex = 25;
    }

    const hpPct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));
    const shieldPct = shieldVal > 0 ? Math.min(100, Math.round((shieldVal / maxHp) * 100)) : 0;

    const elAvatar = hpBarEl.querySelector('#psm-hp-avatar-icon');
    const elLvl = hpBarEl.querySelector('#psm-hp-lvl-badge');
    const elName = hpBarEl.querySelector('#psm-hp-player-name');
    const elValTop = hpBarEl.querySelector('#psm-hp-val-top');
    const elValBottom = hpBarEl.querySelector('#psm-hp-val-bottom');
    const elOverlayTxt = hpBarEl.querySelector('#psm-hp-overlay-txt');
    const elLiveFill = hpBarEl.querySelector('#psm-hp-live-fill');
    const elGhostFill = hpBarEl.querySelector('#psm-hp-ghost-fill');
    const elShieldFill = hpBarEl.querySelector('#psm-hp-shield-fill');

    if (elName && elName.textContent !== pName) elName.textContent = pName;
    if (elLvl && elLvl.textContent !== `Nv. ${pLvl}`) elLvl.textContent = `Nv. ${pLvl}`;

    if (elAvatar) {
      if (pDex) {
        const spriteUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pDex}.png`;
        if (elAvatar.dataset.dex !== String(pDex)) {
          elAvatar.dataset.dex = String(pDex);
          elAvatar.innerHTML = `<img src="${spriteUrl}" class="psm-hp-sprite-img" alt="${escapeHtml(pName)}" onerror="this.remove()" />`;
        }
      } else {
        delete elAvatar.dataset.dex;
        const pLower = pName.toLowerCase();
        if (/pika|raichu|voltorb|electr/i.test(pLower)) elAvatar.textContent = '⚡';
        else if (/char|vulpix|growl|flareon|fuego|fire/i.test(pLower)) elAvatar.textContent = '🔥';
        else if (/squirt|blastoise|vaporeon|psyduck|agua|water/i.test(pLower)) elAvatar.textContent = '💧';
        else if (/bulba|venusaur|planta|grass|chiko|oddish/i.test(pLower)) elAvatar.textContent = '🌿';
        else if (/gengar|haunter|gastly|ghost/i.test(pLower)) elAvatar.textContent = '👻';
        else elAvatar.textContent = '🐾';
      }
    }

    const isMinimal = hpBarConfig.theme === 'minimal';
    const hpTopText = isMinimal
      ? `Nv. ${pLvl}`
      : `PS: ${Math.round(curHp)} / ${Math.round(maxHp)} (${hpPct}%)`;
    const hpBottomText = isMinimal
      ? `Nv. ${pLvl}`
      : `PS: ${Math.round(curHp)} / ${Math.round(maxHp)}`;
    const hpOverlayText = isMinimal
      ? `${Math.round(curHp)} / ${Math.round(maxHp)}`
      : `${hpPct}%`;

    if (elValTop && elValTop.textContent !== hpTopText) elValTop.textContent = hpTopText;
    if (elValBottom && elValBottom.textContent !== hpBottomText) elValBottom.textContent = hpBottomText;
    if (elOverlayTxt && elOverlayTxt.textContent !== hpOverlayText) elOverlayTxt.textContent = hpOverlayText;

    const isVertical = hpBarConfig.orientation === 'vertical';

    if (elLiveFill) {
      elLiveFill.classList.toggle('low', hpPct <= 45 && hpPct > 20);
      elLiveFill.classList.toggle('crit', hpPct <= 20);
      if (isVertical) {
        elLiveFill.style.height = `${hpPct}%`;
        elLiveFill.style.width = '100%';
      } else {
        elLiveFill.style.width = `${hpPct}%`;
        elLiveFill.style.height = '100%';
      }
    }

    if (elGhostFill) {
      if (isVertical) {
        elGhostFill.style.height = `${hpPct}%`;
        elGhostFill.style.width = '100%';
      } else {
        elGhostFill.style.width = `${hpPct}%`;
        elGhostFill.style.height = '100%';
      }
    }

    if (elShieldFill) {
      if (shieldPct > 0) {
        elShieldFill.style.display = 'block';
        if (isVertical) {
          elShieldFill.style.height = `${shieldPct}%`;
          elShieldFill.style.width = '100%';
        } else {
          elShieldFill.style.width = `${shieldPct}%`;
          elShieldFill.style.height = '100%';
        }
      } else {
        elShieldFill.style.display = 'none';
      }
    }
  }

  // Inicializar estado de la barra de vida y widget de bufos
  applyHpBarConfig();
  applyBuffsBarConfig();

  const statsHead = statsPanel.querySelector('#psm-stats-head');
  const statsFoldBtn = statsPanel.querySelector('#psm-stats-fold');
  const elRunClock = statsPanel.querySelector('#psm-run-clock');
  const elDpsLive = statsPanel.querySelector('#psm-dps-live');
  const elMejorasBtn = statsPanel.querySelector('#psm-mejoras-btn');
  const elTimersInfo = statsPanel.querySelector('#psm-timers-info');
  const elPlayerRows = statsPanel.querySelector('#psm-player-rows');
  const elExpandableSection = statsPanel.querySelector('#psm-expandable-section');
  const elBuffsPanel = statsPanel.querySelector('#psm-buffs-panel');
  const elStMaxDps = statsPanel.querySelector('#psm-st-maxdps');
  const elStMax = statsPanel.querySelector('#psm-st-max');
  const elStAvg = statsPanel.querySelector('#psm-st-avg');
  const elStHits = statsPanel.querySelector('#psm-st-hits');
  const elPokeHeader = statsPanel.querySelector('#psm-poke-header');
  const elLvlBadge = statsPanel.querySelector('#psm-lvl-badge');
  const elPassivesList = statsPanel.querySelector('#psm-passives-container');
  const elMovesList = statsPanel.querySelector('#psm-moves-container');

  // Fallback para recalcular Camera.scale/w/h si la extensión se cargó tras document_start sin recargar la página
  let mathMinFovHooked = false;
  function applyEngineFovFallback() {
    if (!mathMinFovHooked) {
      mathMinFovHooked = true;
      const origMathMin = Math.min;
      Math.min = function(a, b) {
        const res = origMathMin.apply(this, arguments);
        if (arguments.length === 2 && fovZoom !== 1.0 && gameCanvas) {
          const cw = gameCanvas.width || gameCanvas.clientWidth || window.innerWidth;
          const ch = gameCanvas.height || gameCanvas.clientHeight || window.innerHeight;
          if (cw > 0 && ch > 0 && Math.abs(a - cw / 768) < 0.05 && Math.abs(b - ch / 420) < 0.05) {
            return res * fovZoom;
          }
        }
        return res;
      };
    }

    if (!gameCanvas) return;
    const proto = HTMLCanvasElement.prototype;
    const wDesc = Object.getOwnPropertyDescriptor(proto, 'width');
    const hDesc = Object.getOwnPropertyDescriptor(proto, 'height');
    try {
      Object.defineProperty(gameCanvas, 'width', { get: () => wDesc.get.call(gameCanvas), set: () => {}, configurable: true });
      Object.defineProperty(gameCanvas, 'height', { get: () => hDesc.get.call(gameCanvas), set: () => {}, configurable: true });
      window.dispatchEvent(new Event('resize'));
    } catch (_) {
    } finally {
      delete gameCanvas.width;
      delete gameCanvas.height;
    }
  }

  function applyEngineFov() {
    if (!syncEngineCameraFov()) {
      applyEngineFovFallback();
    }
  }

  function updateFovBadge() {
    if (!fovBadge) return;
    fovBadge.textContent = `FOV ${fovZoom.toFixed(1)}×`;
    if (Math.abs(fovZoom - 1.0) > 0.01) {
      fovBadge.classList.add('psm-fov-active');
    } else {
      fovBadge.classList.remove('psm-fov-active');
    }
  }

  function setFovZoom(val) {
    fovZoom = Math.max(MIN_FOV, Math.min(MAX_FOV, Math.round(val * 100) / 100));
    try {
      localStorage.setItem(FOV_STORAGE_KEY, String(fovZoom));
    } catch (_) {}
    applyEngineFov();
    updateFovBadge();
    updateZoomUI();
  }

  function resetFovZoom() {
    fovZoom = 1.0;
    try {
      localStorage.setItem(FOV_STORAGE_KEY, '1');
    } catch (_) {}
    applyEngineFov();
    updateFovBadge();
    updateZoomUI();
  }

  if (fovBadge) {
    fovBadge.addEventListener('click', e => {
      e.stopPropagation();
      resetFovZoom();
    });
  }

  function toggleBuffsSection() {
    showBuffsPanel = !showBuffsPanel;
    try {
      localStorage.setItem(SHOW_BUFFS_KEY, String(showBuffsPanel));
    } catch (_) {}
    if (elMejorasBtn) elMejorasBtn.classList.toggle('active', showBuffsPanel);
    if (elExpandableSection) elExpandableSection.hidden = !showBuffsPanel;
    if (showBuffsPanel) lastRenderedBuildSig = '';
    if (activeRun) {
      renderStatsUI();
      clampStatsPanelToViewport();
    }
  }

  if (elMejorasBtn) {
    elMejorasBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleBuffsSection();
      elMejorasBtn.blur();
    });
  }

  if (elPlayerRows) {
    elPlayerRows.addEventListener('click', e => {
      if (!e.target.closest('.psm-pl-row.me')) return;
      showOwnMovesInRow = !showOwnMovesInRow;
      try {
        localStorage.setItem(SHOW_MOVES_KEY, String(showOwnMovesInRow));
      } catch (_) {}
      renderStatsUI();
    });
  }

  const elHistCount = historyModal.querySelector('#psm-hist-count');
  const elRecTime = historyModal.querySelector('#psm-rec-time');
  const elRecDps = historyModal.querySelector('#psm-rec-dps');
  const elRecKills = historyModal.querySelector('#psm-rec-kills');
  const elHistList = historyModal.querySelector('#psm-hist-list');

  function clampMapPanelToViewport() {
    if (!mapHasCustomPosition || !mapPanel.classList.contains('psm-in-run')) return;
    const rect = mapPanel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const clampedLeft = Math.max(0, Math.min(maxLeft, rect.left));
    const clampedTop = Math.max(0, Math.min(maxTop, rect.top));
    mapPanel.style.left = `${Math.round(clampedLeft)}px`;
    mapPanel.style.top = `${Math.round(clampedTop)}px`;
    mapPanel.style.right = 'auto';
    mapPanel.style.bottom = 'auto';
  }

  function resetMapPanelPosition() {
    mapHasCustomPosition = false;
    mapPanel.style.left = 'auto';
    mapPanel.style.top = 'auto';
    mapPanel.style.right = '14px';
    mapPanel.style.bottom = '14px';
  }

  function clampStatsPanelToViewport() {
    if (!statsHasCustomPosition || !statsPanel.classList.contains('psm-in-run')) return;
    const rect = statsPanel.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const clampedLeft = Math.max(0, Math.min(maxLeft, rect.left));
    const clampedTop = Math.max(0, Math.min(maxTop, rect.top));
    statsPanel.style.left = `${Math.round(clampedLeft)}px`;
    statsPanel.style.top = `${Math.round(clampedTop)}px`;
    statsPanel.style.right = 'auto';
    statsPanel.style.bottom = 'auto';
  }

  function resetStatsPanelPosition() {
    statsHasCustomPosition = false;
    statsPanel.style.left = '14px';
    statsPanel.style.top = '75px';
    statsPanel.style.right = 'auto';
    statsPanel.style.bottom = 'auto';
  }

  window.addEventListener('resize', () => {
    clampMapPanelToViewport();
    clampStatsPanelToViewport();
    clampHpBarToViewport();
  });

  function setupDraggable(panelEl, headEl, resetPosFn, setCustomFn) {
    headEl.addEventListener('dblclick', event => {
      if (event.target.closest('button, input, select, .psm-fov-badge')) return;
      resetPosFn();
    });

    headEl.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button, input, select, .psm-fov-badge')) return;
      event.preventDefault();

      const rect = panelEl.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;

      setCustomFn(true);
      panelEl.style.left = `${Math.round(startLeft)}px`;
      panelEl.style.top = `${Math.round(startTop)}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';

      headEl.setPointerCapture(event.pointerId);

      const move = e => {
        const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
        const nextLeft = Math.max(0, Math.min(maxLeft, startLeft + e.clientX - startX));
        const nextTop = Math.max(0, Math.min(maxTop, startTop + e.clientY - startY));

        panelEl.style.left = `${Math.round(nextLeft)}px`;
        panelEl.style.top = `${Math.round(nextTop)}px`;
      };

      const end = e => {
        try { headEl.releasePointerCapture(e.pointerId); } catch (_) {}
        headEl.removeEventListener('pointermove', move);
        headEl.removeEventListener('pointerup', end);
        headEl.removeEventListener('pointercancel', end);
      };

      headEl.addEventListener('pointermove', move);
      headEl.addEventListener('pointerup', end);
      headEl.addEventListener('pointercancel', end);
    });
  }

  setupDraggable(mapPanel, mapHead, resetMapPanelPosition, val => { mapHasCustomPosition = val; });
  setupDraggable(statsPanel, statsHead, resetStatsPanelPosition, val => { statsHasCustomPosition = val; });

  function applyPanelSize(save = false) {
    mapPanel.style.width = `${panelWidth}px`;
    mapPanel.style.setProperty('--psm-content-h', `${contentHeight}px`);
    const isModified = panelWidth !== DEFAULT_PANEL_W || contentHeight !== DEFAULT_CONTENT_H;
    sizeResetBtn.classList.toggle('modified', isModified);

    if (save) {
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ w: panelWidth, h: contentHeight }));
      } catch (_) {}
    }
  }

  function resetPanelSize() {
    panelWidth = DEFAULT_PANEL_W;
    contentHeight = DEFAULT_CONTENT_H;
    applyPanelSize(true);
    clampMapPanelToViewport();
  }

  sizeResetBtn.addEventListener('click', e => {
    e.stopPropagation();
    resetPanelSize();
  });

  resizeGrip.addEventListener('dblclick', e => {
    e.stopPropagation();
    resetPanelSize();
  });

  resizeGrip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panelWidth;
    const startH = contentHeight;

    const rect = mapPanel.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;

    mapHasCustomPosition = true;
    mapPanel.style.left = `${Math.round(startLeft)}px`;
    mapPanel.style.top = `${Math.round(startTop)}px`;
    mapPanel.style.right = 'auto';
    mapPanel.style.bottom = 'auto';

    resizeGrip.setPointerCapture(e.pointerId);

    const onMove = ev => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      const maxAllowedW = Math.max(220, Math.min(720, window.innerWidth - 12));
      const maxAllowedH = Math.max(170, Math.min(720, window.innerHeight - 130));

      panelWidth = Math.max(220, Math.min(maxAllowedW, Math.round(startW + dx)));
      contentHeight = Math.max(170, Math.min(maxAllowedH, Math.round(startH + dy)));
      applyPanelSize(false);

      const nextLeft = Math.max(4, Math.min(startLeft, window.innerWidth - mapPanel.offsetWidth - 4));
      const nextTop = Math.max(4, Math.min(startTop, window.innerHeight - mapPanel.offsetHeight - 4));
      mapPanel.style.left = `${Math.round(nextLeft)}px`;
      mapPanel.style.top = `${Math.round(nextTop)}px`;
    };

    const onUp = ev => {
      try { resizeGrip.releasePointerCapture(ev.pointerId); } catch (_) {}
      resizeGrip.removeEventListener('pointermove', onMove);
      resizeGrip.removeEventListener('pointerup', onUp);
      resizeGrip.removeEventListener('pointercancel', onUp);
      applyPanelSize(true);
    };

    resizeGrip.addEventListener('pointermove', onMove);
    resizeGrip.addEventListener('pointerup', onUp);
    resizeGrip.addEventListener('pointercancel', onUp);
  });

  applyPanelSize(false);

  mapFoldBtn.addEventListener('click', () => {
    mapCollapsed = !mapCollapsed;
    mapPanel.classList.toggle('psm-folded', mapCollapsed);
    mapFoldBtn.textContent = mapCollapsed ? '▣' : '▁';
    if (!mapCollapsed) {
      clampMapPanelToViewport();
      drawMap(true);
    }
  });

  statsFoldBtn.addEventListener('click', () => {
    statsCollapsed = !statsCollapsed;
    statsPanel.classList.toggle('psm-folded', statsCollapsed);
    statsFoldBtn.textContent = statsCollapsed ? '▣' : '▁';
    if (!statsCollapsed) {
      clampStatsPanelToViewport();
      renderStatsUI();
    }
  });

  mapPanel.querySelector('#psm-passive-out').addEventListener('click', () => {
    radiusWorld = Math.min(MAX_MAP_RADIUS, Math.round(radiusWorld * 1.3));
    updateZoomUI();
  });

  mapPanel.querySelector('#psm-passive-in').addEventListener('click', () => {
    radiusWorld = Math.max(MIN_MAP_RADIUS, Math.round(radiusWorld / 1.3));
    updateZoomUI();
  });

  function getEffectiveMapRadius() {
    let r = radiusWorld;
    if (viewBounds) {
      const halfSpan = Math.max(
        (viewBounds.maxX - viewBounds.minX) / 2,
        (viewBounds.maxY - viewBounds.minY) / 2
      );
      if (Number.isFinite(halfSpan) && halfSpan > 0) {
        r = Math.max(radiusWorld, Math.round(halfSpan * 1.15));
      }
    }
    return Math.min(MAX_MAP_RADIUS, r);
  }

  function updateZoomUI() {
    const effR = getEffectiveMapRadius();
    zoomLabel.textContent = `${(1800 / effR).toFixed(1)}×`;
  }

  function updateRecenterButton() {
    const isOffCenter = Math.hypot(panOffset.x, panOffset.y) > 5;
    recenterBtn.classList.toggle('visible', isOffCenter);
  }

  function resetPan() {
    panOffset.x = 0;
    panOffset.y = 0;
    updateRecenterButton();
  }

  recenterBtn.addEventListener('click', e => {
    e.stopPropagation();
    resetPan();
  });

  mapCanvas.addEventListener('dblclick', resetPan);

  mapCanvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    isPanningMap = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = panOffset.x;
    const startPanY = panOffset.y;

    mapCanvas.setPointerCapture(e.pointerId);

    const onMove = ev => {
      if (!isPanningMap) return;
      const effR = getEffectiveMapRadius();
      const scale = SIZE / (effR * 2);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      panOffset.x = startPanX - dx / scale;
      panOffset.y = startPanY - dy / scale;
      updateRecenterButton();
    };

    const onUp = ev => {
      isPanningMap = false;
      try { mapCanvas.releasePointerCapture(ev.pointerId); } catch (_) {}
      mapCanvas.removeEventListener('pointermove', onMove);
      mapCanvas.removeEventListener('pointerup', onUp);
      mapCanvas.removeEventListener('pointercancel', onUp);
    };

    mapCanvas.addEventListener('pointermove', onMove);
    mapCanvas.addEventListener('pointerup', onUp);
    mapCanvas.addEventListener('pointercancel', onUp);
  });

  mapCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    radiusWorld = Math.max(MIN_MAP_RADIUS, Math.min(MAX_MAP_RADIUS, Math.round(radiusWorld * factor)));
    updateZoomUI();
  }, { passive: false });

  legendEl.addEventListener('click', e => {
    const keyEl = e.target.closest('.psm-key');
    if (!keyEl) return;
    const cat = keyEl.dataset.cat;
    if (!cat) return;

    visibility[cat] = !visibility[cat];
    keyEl.classList.toggle('psm-off', !visibility[cat]);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
    } catch (_) {}
  });

  const IGNORED_MENU_WORDS = new Set([
    'pokésurvivor', 'mundo misterioso', 'normal', 'shiny', 'normal shiny',
    'jugar', 'entra en la mazmorra', 'pokémon', 'mejoras', 'gacha', 'historial',
    '📜 historial', 'fuego', 'agua', 'planta', 'eléctrico', 'psíquico', 'hielo',
    'dragón', 'siniestro', 'hada', 'lucha', 'volador', 'veneno', 'tierra',
    'roca', 'bicho', 'fantasma', 'acero'
  ]);

  function detectCompanionFromMenu() {
    const topbarEl = document.getElementById('topbar');
    if (topbarEl) {
      const tbLines = (topbarEl.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      for (const l of tbLines) {
        if (
          !/^[\d.,\s]+$/.test(l) &&
          !/^(novedades|apoyar|salir)$/i.test(l) &&
          l.length >= 2 &&
          l.length <= 20
        ) {
          localPlayerNick = l.toLowerCase();
          break;
        }
      }
    }

    const menuEl = document.getElementById('scr-menu');
    if (!menuEl) return;
    const lines = (menuEl.innerText || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const idx = lines.findIndex(l => /mundo misterioso/i.test(l));
    if (idx !== -1) {
      for (let i = idx + 1; i < Math.min(lines.length, idx + 6); i++) {
        const candidate = lines[i];
        const lower = candidate.toLowerCase();
        if (
          !IGNORED_MENU_WORDS.has(lower) &&
          !/^\d/.test(candidate) &&
          candidate.length >= 3 &&
          candidate.length <= 22
        ) {
          companionName = candidate;
          break;
        }
      }
    }
  }

  function isNonDamagingMove(title, desc = '') {
    const lower = (title || '').toLowerCase();
    if (NON_DAMAGING_MOVES.has(lower)) return true;
    if (/no hace daño/i.test(desc || '')) return true;
    return false;
  }

  function registerOrGetMove(moveName, moveType = '', initialCount = 1, moveDesc = '', isStarter = false) {
    const cleanTitle = sanitizeMoveTitle(moveName);
    if (!cleanTitle || cleanTitle.length < 2 || /^[1234]$/.test(cleanTitle)) return null;

    const key = cleanTitle.toLowerCase();
    if (KNOWN_PASSIVES.has(key) || IGNORED_HUD_TEXTS.has(key)) return null;

    let mv = activeMoves.get(key);
    if (!mv) {
      mv = {
        title: cleanTitle,
        typeTag: moveType,
        count: initialCount,
        desc: moveDesc,
        nonDamaging: isNonDamagingMove(cleanTitle, moveDesc),
        isStarter: Boolean(isStarter),
        bonded: false,
        bondOrder: null,
        damage: 0,
        hits: 0
      };
      activeMoves.set(key, mv);

      if (unassignedInitialDamage > 0 && !mv.nonDamaging) {
        mv.damage += unassignedInitialDamage;
        unassignedInitialDamage = 0;
      }
    } else {
      if (isNonDamagingMove(cleanTitle, moveDesc)) mv.nonDamaging = true;
      if (isStarter) mv.isStarter = true;
    }
    return mv;
  }

  function inspectCanvasHudTextForStarterMoves(rawText, screenX, screenY, context) {
    let effY = screenY;
    if (context && typeof context.getTransform === 'function') {
      const m = context.getTransform();
      effY = m.b * screenX + m.d * screenY + m.f;
    }
    if (effY < gameCanvas.height * 0.42 && screenY < gameCanvas.clientHeight * 0.42) return;

    const str = String(rawText || '').trim();
    if (str.length < 3 || str.length > 26) return;

    if (/^[\d.,:\/+\-%\s!x×]+$/i.test(str)) return;
    if (/^(nv\.?\s*\d+|lv\.?\s*\d+|nivel\s*\d+|ola\s*\d+|wave\s*\d+)$/i.test(str)) return;

    const clean = sanitizeMoveTitle(str);
    if (!clean || clean.length < 3 || clean.length > 24) return;

    const lower = clean.toLowerCase();
    if (IGNORED_HUD_TEXTS.has(lower) || KNOWN_PASSIVES.has(lower)) return;
    if (localPlayerNick && lower === localPlayerNick) return;
    if (companionName && lower === companionName.toLowerCase()) return;
    if (alliesByName.has(lower)) return;

    if (!/^[A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ\s-]{2,22}$/.test(clean)) return;

    for (const existing of activeMoves.values()) {
      if (existing.evolvedFrom && existing.evolvedFrom.toLowerCase() === lower) {
        return;
      }
    }

    if (!activeMoves.has(lower)) {
      const isStarter = currentLevel <= 2 && activeMoves.size < 2;
      registerOrGetMove(clean, '', 1, '', isStarter);

      if (isStarter && companionName) {
        const starterList = Array.from(activeMoves.values())
          .filter(m => m.isStarter)
          .map(m => m.title);
        if (starterList.length > 0) {
          saveStarterMovesForPoke(companionName, starterList);
        }
      }

      if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
    }
  }

  function startNewRunSession() {
    chunks.clear();
    allyExploredZones.clear();
    trackedEntities.clear();
    alliesByName.clear();
    rememberedObjects.clear();
    permanentProps.clear();
    trail.length = 0;

    passiveUpgrades.clear();
    activeMoves.clear();
    equippedItem = null;
    pendingBondFirstMove = null;
    bondOrderSeq = 1;
    currentLevel = 1;
    runStartedAt = Date.now();
    runSavedForCurrentSession = false;
    lastRenderedBuildSig = '';

    // Reset estado de motor por partida (Daño por ataque, Co-op, Grietas, XP)
    engineMoveDmg.clear();
    coopDamageRows.clear();
    buffMaxDurMap.clear();
    canvasCapturedBuffs.clear();
    lastRenderedBuffsSig = '';
    engineRunTime = 0;
    lastClockTickAt = performance.now();
    riftState = { timer: RIFT_EVERY, fails: 0, open: false };
    xpHist = [];
    xpLast = null;

    activeFloatingTexts.length = 0;
    damageEvents.length = 0;
    totalDamageDealt = 0;
    unassignedInitialDamage = 0;
    maxSingleHit = 0;
    totalHitsCount = 0;
    maxDpsRecorded = 0;

    lastPokemonDraw = null;
    centerWorld = null;
    viewCorners = [];
    viewBounds = null;
    detectCompanionFromMenu();

    const engPl = getEngineLocalPlayer();
    if (engPl && engPl.mon && engPl.mon.name) {
      companionName = engPl.mon.name;
    }

    if (companionName) {
      const knownStarters = starterMovesByPoke[companionName.toLowerCase()];
      if (Array.isArray(knownStarters)) {
        for (const stName of knownStarters) {
          registerOrGetMove(stName, '', 1, '', true);
        }
      }
    }

    resetPan();
    if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
  }

  function isVisible(element) {
    return !!element &&
      !element.classList.contains('hidden') &&
      element.getClientRects().length > 0;
  }

  function isMainMenuActive() {
    // 1. Menú principal (#scr-menu) o pantallas de arranque (#boot, #tap-start)
    const menuEl = document.getElementById('scr-menu');
    if (menuEl && !menuEl.classList.contains('hidden')) {
      const display = menuEl.style.display || window.getComputedStyle(menuEl).display;
      if (display !== 'none') return true;
    }
    const bootEl = document.getElementById('boot');
    if (bootEl && !bootEl.classList.contains('hidden')) {
      const display = bootEl.style.display || window.getComputedStyle(bootEl).display;
      if (display !== 'none') return true;
    }
    const tapEl = document.getElementById('tap-start');
    if (tapEl && !tapEl.classList.contains('hidden')) {
      const display = tapEl.style.display || window.getComputedStyle(tapEl).display;
      if (display !== 'none') return true;
    }
    // 2. Pantallas de lobby o menús fuera de partida
    for (const id of ['scr-title', 'scr-shop', 'scr-collection', 'scr-evolve', 'scr-news', 'scr-support']) {
      const el = document.getElementById(id);
      if (el && isVisible(el)) return true;
    }
    // 3. Botones exclusivos del menú superior de lobby (Guardar, Salir)
    const btnSave = document.getElementById('btn-save');
    const btnLogout = document.getElementById('btn-logout');
    if ((btnSave && isVisible(btnSave)) || (btnLogout && isVisible(btnLogout))) {
      return true;
    }
    return false;
  }

  function detectGameplay() {
    // Si estamos en el Menú Principal o pantallas de arranque
    if (isMainMenuActive()) return false;

    // Si el engine de PokéSurvivor está cargado, comprobar su estado interno
    const NS = gameNS || window.__psmNS || window.__psmodNS || window.__psmGameNS;
    if (NS && NS.Game) {
      if (typeof NS.Game.state === 'string') {
        if (NS.Game.state !== 'playing') return false;
      }
      if (NS.Game.player === null && !(NS.Coop && NS.Coop.active && NS.Coop.local)) {
        return false;
      }
    }

    // Comprobación de pantallas .scr visibles
    const visibleScreens = Array.from(document.querySelectorAll('.scr')).filter(isVisible);
    if (visibleScreens.length > 0) {
      if (visibleScreens.some(element => !RUN_OVERLAYS.has(element.id))) {
        return false;
      }
    }

    if (isVisible(document.getElementById('boot'))) return false;
    if (isVisible(document.getElementById('tap-start'))) return false;

    const menuEl = document.getElementById('scr-menu');
    if (menuEl && !menuEl.classList.contains('hidden')) return false;

    const canvas = document.getElementById('game') || document.querySelector('canvas#game');
    if (!canvas) return false;

    return true;
  }

  function isAnyModalOrOverlayOpen() {
    // La atenuación de pausa SOLO debe activarse si activeRun es true
    if (!activeRun) return false;
    if (isEditingUI) return false;
    if (historyModal && historyModal.classList.contains('open')) return true;
    for (const id of ['scr-pause', 'scr-levelup', 'scr-bond', 'scr-item', 'scr-over']) {
      const el = document.getElementById(id);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function syncHudModalDimming() {
    if (!activeRun) {
      if (hpBarEl) hpBarEl.classList.remove('psm-modal-dimmed');
      if (buffsBarEl) buffsBarEl.classList.remove('psm-modal-dimmed');
      if (mapPanel) mapPanel.classList.remove('psm-modal-dimmed');
      if (statsPanel) statsPanel.classList.remove('psm-modal-dimmed');
      return;
    }
    const dimmed = isAnyModalOrOverlayOpen();
    if (hpBarEl) hpBarEl.classList.toggle('psm-modal-dimmed', dimmed);
    if (buffsBarEl) buffsBarEl.classList.toggle('psm-modal-dimmed', dimmed);
    if (mapPanel) mapPanel.classList.toggle('psm-modal-dimmed', dimmed);
    if (statsPanel) statsPanel.classList.toggle('psm-modal-dimmed', dimmed);
  }

  function updateHudVisibility() {
    const shouldShow = activeRun && !hiddenByUser;
    document.body.classList.toggle('psm-in-run', Boolean(activeRun));
    mapPanel.classList.toggle('psm-in-run', shouldShow);
    statsPanel.classList.toggle('psm-in-run', shouldShow);
    if (hpBarEl) {
      const showHp = (activeRun || isEditingUI);
      hpBarEl.classList.toggle('psm-in-run', activeRun);
      if (showHp) {
        clampHpBarToViewport();
        updateCustomHpBar();
      }
    }
    if (buffsBarEl) {
      const showBuffs = (activeRun || isEditingUI);
      buffsBarEl.classList.toggle('psm-in-run', activeRun);
      if (showBuffs) {
        clampBuffsBarToViewport();
        updateCustomBuffsBar();
      }
    }
    syncHudModalDimming();
    if (shouldShow) {
      clampMapPanelToViewport();
      clampStatsPanelToViewport();
    }
  }

  // ------------------------------------------------------------------
  // GUARDADO AUTOMÁTICO DE RUNS EN EL HISTORIAL (#scr-over / Abandonar)
  // ------------------------------------------------------------------

  function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(n => parseInt(n, 10));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  }

  function formatSecondsToMMSS(sec) {
    const sTotal = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sTotal / 60);
    const s = sTotal % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function getEngineMoveBreakdown() {
    const p = getEngineLocalPlayer();
    const names = { burn: 'Quemaduras', poison: 'Veneno', other: 'Otros' };
    const moveMetaById = new Map();
    if (p && Array.isArray(p.moves)) {
      for (const m of p.moves) {
        if (m && m.id) {
          names[m.id] = m.name || m.id;
          moveMetaById.set(m.id, m);
        }
      }
    }
    const total = [...engineMoveDmg.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return [];
    return [...engineMoveDmg.entries()]
      .map(([k, v]) => {
        const meta = moveMetaById.get(k);
        return {
          key: k,
          name: names[k] || k,
          dmg: Math.round(v),
          pct: total > 0 ? v / total : 0,
          lvl: meta ? (meta.lvl || 1) : 1,
          evolved: !!(meta && meta.evolved)
        };
      })
      .sort((a, b) => b.dmg - a.dmg);
  }

  function getCoopPlayerEntries() {
    const p = getEngineLocalPlayer();
    if (!p) {
      const fallbackName = (gameNS && gameNS.Social && gameNS.Social.me && gameNS.Social.me.name) || localPlayerNick || companionName || 'Tú';
      return [{
        name: fallbackName,
        color: '#ffd23f',
        dmg: totalDamageDealt || 0,
        exact: true,
        me: true,
        hp: null,
        maxHp: null,
        dead: false
      }];
    }

    const myDmgVal = Math.max(getEngineMyDamage(), totalDamageDealt || 0);
    const list = [{
      name: (gameNS && gameNS.Social && gameNS.Social.me && gameNS.Social.me.name) || localPlayerNick || 'Tú',
      color: p.tagColor || '#ffd23f',
      dmg: myDmgVal,
      exact: true,
      me: true,
      hp: p.hp,
      maxHp: p.maxHp,
      dead: !!p.dead
    }];

    if (gameNS && gameNS.Coop && gameNS.Coop.active && Array.isArray(gameNS.Coop.mates)) {
      for (const m of gameNS.Coop.mates) {
        if (!m || !m.connected) continue;
        const r = coopDamageRows.get(m.uid);
        const known = r && (r.live || gameNS.Coop.isHost);
        const n = (m.pl && m.pl.net) || {};
        list.push({
          name: m.name || 'Aliado',
          color: m.color || '#5fc8ff',
          dmg: known ? (r.live ? r.dmg : r.est) : null,
          exact: !!(r && r.live),
          me: false,
          hp: n.hp,
          maxHp: n.maxHp,
          dead: !!n.dead
        });
      }
    }

    return list.sort((a, b) => (b.dmg ?? -1) - (a.dmg ?? -1));
  }

  function captureAndSaveCurrentRun(fromScreenOver = false) {
    if (runSavedForCurrentSession) return;

    const engPl = getEngineLocalPlayer();
    const elapsedSec = engineRunTime > 0
      ? Math.round(engineRunTime)
      : (runStartedAt ? Math.round((Date.now() - runStartedAt) / 1000) : 0);
    let timeStr = formatSecondsToMMSS(elapsedSec);
    let timeSec = elapsedSec;
    let finalLevel = (engPl && engPl.level) ? Math.max(currentLevel, engPl.level) : currentLevel;
    let kills = (engPl && typeof engPl.kills === 'number') ? engPl.kills : 0;
    let bosses = 0;
    let coins = 0;

    if (engPl && engPl.mon && engPl.mon.name) {
      companionName = engPl.mon.name;
    }
    if (engPl && engPl.item && gameNS && gameNS.Items && gameNS.Items.BY && gameNS.Items.BY[engPl.item]) {
      equippedItem = {
        name: gameNS.Items.BY[engPl.item].name,
        desc: gameNS.Items.BY[engPl.item].desc || ''
      };
    }

    const overEl = document.getElementById('scr-over');
    if (fromScreenOver && overEl) {
      const rawOver = overEl.innerText || '';
      const mTime = rawOver.match(/Tiempo\s*(\d+:\d+)/i);
      const mLvl = rawOver.match(/Nivel\s*(\d+)/i);
      const mKills = rawOver.match(/Derrotados\s*(\d+)/i);
      const mBoss = rawOver.match(/Jefes\s*(\d+)/i);
      const mCoins = rawOver.match(/Pokémonedas ganadas\s*\+?(\d+)/i);

      if (mTime) {
        timeStr = mTime[1];
        timeSec = parseTimeToSeconds(timeStr);
      }
      if (mLvl) finalLevel = Math.max(finalLevel, parseInt(mLvl[1], 10));
      if (mKills) kills = Math.max(kills, parseInt(mKills[1], 10));
      if (mBoss) bosses = parseInt(mBoss[1], 10);
      if (mCoins) coins = parseInt(mCoins[1], 10);

      const mMovesSection = rawOver.match(/Movimientos\s*\n+\s*([^\n]+)/i);
      if (mMovesSection) {
        const parts = mMovesSection[1].split('·').map(s => s.trim()).filter(Boolean);
        const discoveredStarters = [];

        for (let idx = 0; idx < parts.length; idx++) {
          const p = parts[idx];
          const mvMatch = p.match(/^(.+?)\s+Nv\.?\s*(\d+)$/i);
          if (mvMatch) {
            const mName = sanitizeMoveTitle(mvMatch[1]);
            const mLv = parseInt(mvMatch[2], 10) || 1;
            if (!mName) continue;

            if (idx < 2 && finalLevel <= 2) {
              discoveredStarters.push(mName);
            }

            const mKey = mName.toLowerCase();
            if (!activeMoves.has(mKey)) {
              let alreadyEvolved = false;
              for (const existing of activeMoves.values()) {
                if (existing.evolvedFrom && existing.evolvedFrom.toLowerCase() === mKey) {
                  alreadyEvolved = true;
                  break;
                }
              }
              if (!alreadyEvolved) {
                const mvObj = registerOrGetMove(mName, '', mLv, '', idx === 0);
                if (mvObj && unassignedInitialDamage > 0 && !mvObj.nonDamaging) {
                  mvObj.damage = (mvObj.damage || 0) + unassignedInitialDamage;
                  unassignedInitialDamage = 0;
                }
              }
            } else {
              const existing = activeMoves.get(mKey);
              existing.count = Math.max(existing.count, mLv);
            }
          }
        }

        if (companionName && discoveredStarters.length > 0) {
          saveStarterMovesForPoke(companionName, discoveredStarters);
        }
      }
    }

    const effectiveTotalDmg = Math.max(getEngineMyDamage(), totalDamageDealt || 0);

    if (timeSec < 12 && effectiveTotalDmg === 0 && kills === 0) {
      runSavedForCurrentSession = true;
      return;
    }

    runSavedForCurrentSession = true;

    // Si disponemos del desglose exacto del motor (engineMoveDmg), lo priorizamos
    const engineMoves = getEngineMoveBreakdown();
    let movesSnapshot = [];

    if (engineMoves.length > 0) {
      movesSnapshot = engineMoves.map(em => {
        const domMove = activeMoves.get(em.name.toLowerCase());
        return {
          title: em.name,
          count: domMove ? Math.max(domMove.count, em.lvl) : em.lvl,
          bonded: !!(domMove && domMove.bonded),
          bondedWith: (domMove && domMove.bondedWith) || '',
          evolvedFrom: (domMove && domMove.evolvedFrom) || (em.evolved ? 'Evo' : ''),
          damage: em.dmg
        };
      });
    } else {
      if (unassignedInitialDamage > 0 && activeMoves.size > 0) {
        distributeDamageAcrossMoves(unassignedInitialDamage);
        unassignedInitialDamage = 0;
      }

      const allValidMoves = Array.from(activeMoves.values()).filter(m => sanitizeMoveTitle(m.title).length >= 2);
      const damagingMoves = allValidMoves.filter(m => !m.nonDamaging);
      const someDamagingMissed = damagingMoves.some(m => (m.damage || 0) === 0);

      if (effectiveTotalDmg > 0 && damagingMoves.length > 0 && someDamagingMissed) {
        let totalWeight = 0;
        for (const m of damagingMoves) {
          totalWeight += (m.count || 1) * (m.bonded ? 1.35 : 1);
        }
        let blendedSum = 0;
        for (const m of damagingMoves) {
          const w = (m.count || 1) * (m.bonded ? 1.35 : 1);
          const expectedShare = effectiveTotalDmg * (w / totalWeight);
          m.damage = m.damage > 0 ? (m.damage * 0.65 + expectedShare * 0.35) : expectedShare;
          blendedSum += m.damage;
        }
        if (blendedSum > 0) {
          const normFactor = effectiveTotalDmg / blendedSum;
          for (const m of damagingMoves) {
            m.damage = Math.round(m.damage * normFactor);
          }
        }
      }

      movesSnapshot = allValidMoves
        .map(m => ({
          title: sanitizeMoveTitle(m.title),
          count: m.count || 1,
          bonded: !!m.bonded,
          bondedWith: m.bondedWith || '',
          evolvedFrom: m.evolvedFrom || '',
          damage: Math.round(m.damage || 0)
        }))
        .sort((a, b) => b.damage - a.damage || (b.bonded ? 1 : 0) - (a.bonded ? 1 : 0) || b.count - a.count);
    }

    const passivesSnapshot = Array.from(passiveUpgrades.values()).map(p => {
      let valStr = '';
      if (p.hasNumeric) {
        const sign = p.totalVal > 0 ? '+' : '';
        const rounded = Number.isInteger(p.totalVal) ? p.totalVal : parseFloat(p.totalVal.toFixed(2));
        valStr = `${sign}${rounded}${p.unit}`;
      }
      return {
        title: p.title,
        count: p.count,
        valStr
      };
    });

    const coopPlayersSnapshot = getCoopPlayerEntries().map(e => ({
      name: e.name,
      dmg: Math.round(e.dmg || 0),
      me: !!e.me,
      exact: e.exact,
      color: e.color
    }));

    const avgDps = Math.round(effectiveTotalDmg / Math.max(1, timeSec));
    const finalMaxDps = Math.max(maxDpsRecorded, avgDps);

    const d = new Date();
    const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

    const runRecord = {
      id: Date.now(),
      date: dateStr,
      pokemon: companionName || 'Pokémon',
      timeStr,
      timeSec,
      level: finalLevel,
      kills,
      bosses,
      coins,
      maxDps: finalMaxDps,
      avgDps,
      maxHit: maxSingleHit,
      totalDamage: Math.round(effectiveTotalDmg),
      item: equippedItem ? equippedItem.name : null,
      moves: movesSnapshot,
      passives: passivesSnapshot,
      players: coopPlayersSnapshot.length > 1 ? coopPlayersSnapshot : undefined
    };

    runHistory.unshift(runRecord);
    if (runHistory.length > MAX_HISTORY_RUNS) {
      runHistory.length = MAX_HISTORY_RUNS;
    }
    saveHistoryToStorage();

    if (historyModal.classList.contains('open')) {
      renderHistoryUI();
    }
  }

  // ------------------------------------------------------------------
  // PARSER DE TARJETAS Y ATRIBUCIÓN PONDERADA DE DAÑO
  // ------------------------------------------------------------------

  let lastRecordedPickAt = 0;

  function addOrUpdatePassive(rawName, textBody) {
    const cleanName = sanitizeMoveTitle(rawName);
    if (!cleanName) return;

    let val = null;
    let unit = '';
    const numMatch = textBody.match(/([+-]?\d+(?:[.,]\d+)?)\s*(%|\/s|s|HP|PS)?/i);
    if (numMatch) {
      val = parseFloat(numMatch[1].replace(',', '.'));
      unit = numMatch[2] || '';
      if (!unit && /por segundo/i.test(textBody)) unit = '/s';
    }

    const key = cleanName.toLowerCase();
    const prev = passiveUpgrades.get(key);
    if (prev) {
      prev.count += 1;
      if (val !== null) {
        prev.totalVal += val;
        prev.hasNumeric = true;
        if (unit && !prev.unit) prev.unit = unit;
      }
    } else {
      passiveUpgrades.set(key, {
        title: cleanName,
        count: 1,
        totalVal: val !== null ? val : 0,
        hasNumeric: val !== null,
        unit,
        desc: textBody
      });
    }
  }

  function parseGameCard(cardEl, overlayId) {
    if (!cardEl) return;
    const now = Date.now();
    if (now - lastRecordedPickAt < 160) return;
    lastRecordedPickAt = now;

    const lvlNumEl = document.getElementById('lvl-num');
    if (lvlNumEl && overlayId === 'scr-levelup') {
      const parsedLvl = parseInt(lvlNumEl.textContent, 10);
      if (Number.isFinite(parsedLvl) && parsedLvl > currentLevel) {
        currentLevel = parsedLvl;
      }
    }

    const textNodes = [];
    const walker = document.createTreeWalker(cardEl, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.trim();
      if (t) textNodes.push(t);
    }

    while (textNodes.length > 1 && /^[1234]$/.test(textNodes[textNodes.length - 1])) {
      textNodes.pop();
    }

    if (textNodes.length === 0) return;

    if (overlayId === 'scr-levelup') {
      const allCards = cardEl.parentElement ? cardEl.parentElement.querySelectorAll('.card') : [];
      for (const c of allCards) {
        if (c === cardEl) continue;
        const cRaw = (c.innerText || '').trim();
        const lv2Match = cRaw.match(/^([^\n→]+?)\s+(?:Nv\.?|Nivel)\s*2\b/i);
        if (lv2Match) {
          const starterCandidate = sanitizeMoveTitle(lv2Match[1]);
          if (starterCandidate && !KNOWN_PASSIVES.has(starterCandidate.toLowerCase()) && !activeMoves.has(starterCandidate.toLowerCase())) {
            registerOrGetMove(starterCandidate, '', 1, '', true);
          }
        }
      }
    }

    if (overlayId === 'scr-item') {
      let rawItemName = textNodes[0]
        .replace(/^(quedarme con|equipar|llevar|elegir|cambiar por|seguir con)\s+/i, '')
        .replace(/\s*Mejora.*$/i, '')
        .trim();

      const itemDesc = textNodes.slice(1).join(' ');
      equippedItem = { name: rawItemName || textNodes[0], desc: itemDesc };
      if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
      return;
    }

    if (overlayId === 'scr-bond') {
      const bondContainer = cardEl.parentElement;
      if (bondContainer) {
        for (const bCard of bondContainer.querySelectorAll('.card')) {
          const bTitle = sanitizeMoveTitle((bCard.innerText || '').split('\n')[0]);
          if (bTitle && !activeMoves.has(bTitle.toLowerCase())) {
            registerOrGetMove(bTitle, '', 1, '', true);
          }
        }
      }

      const moveTitle = sanitizeMoveTitle(textNodes[0]);
      if (!moveTitle) return;

      const key = moveTitle.toLowerCase();
      let mv = activeMoves.get(key);
      if (!mv) {
        for (const existing of activeMoves.values()) {
          if (existing.title.toLowerCase().includes(key)) {
            mv = existing;
            break;
          }
        }
      }

      if (!mv) {
        mv = registerOrGetMove(moveTitle, '', 1, textNodes.slice(1).join(' '), true);
      }
      if (!mv) return;

      mv.bonded = true;
      if (!mv.bondOrder) mv.bondOrder = bondOrderSeq++;

      if (!pendingBondFirstMove) {
        pendingBondFirstMove = mv;
      } else if (pendingBondFirstMove !== mv) {
        const first = pendingBondFirstMove;
        first.bondedWith = mv.title;
        mv.bondedWith = first.title;
        mv.bondOrder = first.bondOrder;
        pendingBondFirstMove = null;
      }

      if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
      return;
    }

    const rawLine = (cardEl.innerText || '').replace(/\n+\s*[1234]\s*$/, '').trim();

    let rawTitleNode = textNodes[0];
    for (const tn of textNodes) {
      const stripped = sanitizeMoveTitle(tn);
      if (stripped.length >= 2) {
        rawTitleNode = tn;
        break;
      }
    }

    const firstNodeClean = sanitizeMoveTitle(rawTitleNode);
    if (!firstNodeClean) return;
    const firstKey = firstNodeClean.toLowerCase();

    if (rawLine.includes('→') || firstNodeClean.includes('→')) {
      const parts = (firstNodeClean.includes('→') ? firstNodeClean : rawLine.split('\n')[0]).split('→');
      const oldName = sanitizeMoveTitle(parts[0]);
      const newName = sanitizeMoveTitle(parts[1]);

      if (!newName) return;

      const oldKey = oldName.toLowerCase();
      const newKey = newName.toLowerCase();
      const prevMove = activeMoves.get(oldKey);

      if (prevMove) {
        activeMoves.delete(oldKey);
        prevMove.evolvedFrom = prevMove.evolvedFrom || oldName;
        prevMove.title = newName;
        prevMove.count += 1;
        activeMoves.set(newKey, prevMove);
      } else {
        const created = registerOrGetMove(newName, '', 2, textNodes.slice(1).join(' '), true);
        if (created) created.evolvedFrom = oldName;
      }

      if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
      return;
    }

    const hasMejoraWord = /\bMejora\b/i.test(rawLine);
    const isKnownPassive = KNOWN_PASSIVES.has(firstKey) || passiveUpgrades.has(firstKey);

    if (hasMejoraWord || isKnownPassive) {
      const bodyAfterTitle = rawLine.slice(firstNodeClean.length).replace(/^\s*Mejora\s*/i, '').trim();
      addOrUpdatePassive(firstNodeClean, bodyAfterTitle || textNodes.slice(1).join(' '));
      if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
      return;
    }

    const explicitLvlMatch = rawLine.match(/\b(?:Nv\.?|Nivel)\s*(\d+)/i);
    const explicitLvl = explicitLvlMatch ? parseInt(explicitLvlMatch[1], 10) : null;
    const isNewMoveCard = /\bNuevo\b/i.test(rawLine);

    const moveDesc = textNodes.slice(1).join(' ');
    const moveKey = firstNodeClean.toLowerCase();
    const prevMove = activeMoves.get(moveKey);

    if (prevMove) {
      prevMove.count = explicitLvl ? Math.max(prevMove.count + 1, explicitLvl) : prevMove.count + 1;
      if (moveDesc) prevMove.desc = moveDesc;
      if (isNonDamagingMove(firstNodeClean, moveDesc)) prevMove.nonDamaging = true;
    } else {
      const initialLv = explicitLvl ? explicitLvl : (isNewMoveCard ? 1 : 2);
      registerOrGetMove(firstNodeClean, '', initialLv, moveDesc, !isNewMoveCard);
    }

    if (activeRun && !statsCollapsed && !hiddenByUser) renderStatsUI();
  }

  function distributeDamageAcrossMoves(val) {
    if (activeMoves.size === 0) {
      unassignedInitialDamage += val;
      return;
    }

    const candidates = Array.from(activeMoves.values()).filter(m => !m.nonDamaging);
    if (candidates.length === 0) {
      unassignedInitialDamage += val;
      return;
    }

    let totalWeight = 0;
    for (const m of candidates) {
      const w = (m.count || 1) * (m.bonded ? 1.35 : 1);
      totalWeight += w;
    }

    for (const m of candidates) {
      const w = (m.count || 1) * (m.bonded ? 1.35 : 1);
      const share = totalWeight > 0 ? w / totalWeight : 1 / candidates.length;
      m.damage = (m.damage || 0) + val * share;
      m.hits = (m.hits || 0) + 1;
    }
  }

  document.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const pauseBtn = target.closest('#scr-pause button, #scr-pause .btn');
    if (activeRun && pauseBtn && pauseBtn.id !== 'psm-pause-hist-btn' && pauseBtn.id !== 'psm-pause-edit-ui-btn' && /abandonar|salir|menú|menu/i.test(pauseBtn.textContent || '')) {
      captureAndSaveCurrentRun(false);
      return;
    }

    if (!activeRun) return;

    if (target.id === 'bond-back' || target.closest('#bond-back')) {
      pendingBondFirstMove = null;
      return;
    }

    const overlay = target.closest('#scr-levelup, #scr-item, #scr-bond');
    if (!overlay || !isVisible(overlay)) return;

    const card = target.closest('.card');
    if (card) {
      parseGameCard(card, overlay.id);
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (!activeRun || e.repeat) return;

    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx === -1) return;

    for (const id of ['scr-levelup', 'scr-item', 'scr-bond']) {
      const overlay = document.getElementById(id);
      if (overlay && isVisible(overlay)) {
        const cards = overlay.querySelectorAll('.card');
        if (cards[idx]) parseGameCard(cards[idx], id);
        break;
      }
    }
  }, true);

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toString();
  }

  function getCurrentDPS() {
    const now = Date.now();
    while (damageEvents.length && now - damageEvents[0].t > 3000) {
      damageEvents.shift();
    }
    let sum = 0;
    for (const ev of damageEvents) sum += ev.dmg;
    const currentDps = Math.round(sum / 3);

    if (currentDps > maxDpsRecorded) {
      maxDpsRecorded = currentDps;
    }
    return currentDps;
  }

  function formatClockSec(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function formatDecEs(n, d = 2) {
    return Number(n || 0).toFixed(d).replace('.', ',');
  }

  function formatPctMultiplier(mul) {
    const v = Math.round((Number(mul || 1) - 1) * 100);
    return (v >= 0 ? '+' : '') + v + ' %';
  }

  function tickEngineClockAndXp() {
    if (!activeRun) return;
    const NS = gameNS || window.__psmNS;
    const p = getEngineLocalPlayer();
    const now = performance.now();

    if (p && p !== engineRunPlayer) {
      engineRunPlayer = p;
      engineMoveDmg.clear();
      coopDamageRows.clear();
      engineRunTime = 0;
      lastClockTickAt = now;
      riftState = { timer: RIFT_EVERY, fails: 0, open: false };
      xpHist = [];
      xpLast = null;
    }

    if (lastClockTickAt > 0) {
      const dt = (now - lastClockTickAt) / 1000;
      if (dt > 0 && dt < 2 && p && !p.dead && !isVisible(document.getElementById('scr-pause'))) {
        engineRunTime += dt;
      }
    }
    lastClockTickAt = now;

    const elapsedSec = getEngineRunSeconds();
    if (!p || !NS || !NS.Upgrades) return;

    if (p.level !== xpPrevLv || p.xp !== xpPrevVal) {
      let totalXp = p.xp || 0;
      for (let l = 1; l < (p.level || 1); l++) {
        try {
          totalXp += NS.Upgrades.xpFor(l);
        } catch (_) {}
      }
      xpHist.push([elapsedSec, totalXp]);
      xpPrevLv = p.level;
      xpPrevVal = p.xp;
    }
    while (xpHist.length > 2 && elapsedSec - xpHist[0][0] > 30) {
      xpHist.shift();
    }
  }

  function buildTimersInfoHtml() {
    const NS = gameNS || window.__psmNS;
    const p = getEngineLocalPlayer();
    const runSec = getEngineRunSeconds();
    const lines = [];

    if (p) {
      const currentLv = p.level || currentLevel || 1;
      let rate = 0;
      if (xpHist.length >= 2) {
        const [t0, x0] = xpHist[0];
        const [t1, x1] = xpHist[xpHist.length - 1];
        if (t1 - t0 >= 2) rate = (x1 - x0) / (t1 - t0);
      }
      const left = Math.max(0, (p.xpNext || 0) - (p.xp || 0));
      if (rate > 0.1 && left > 0) {
        lines.push(`Nv. <b>${currentLv}</b> - subes en <b>${formatClockSec(left / rate)}</b>`);
      } else {
        const pct = p.xpNext ? Math.round(((p.xp || 0) / p.xpNext) * 100) : 0;
        lines.push(`Nv. <b>${currentLv}</b> (${pct} %)`);
      }
    } else {
      lines.push(`Nv. <b>${currentLevel}</b>`);
    }

    const J = NS && NS.Judgment;
    const judgmentAt = (J && typeof J.AT === 'number') ? J.AT : 1800;
    const judgmentActive = Boolean(J && J.active);
    if (!judgmentActive && runSec < judgmentAt) {
      lines.push(`Legendarios en <b>${formatClockSec(judgmentAt - runSec)}</b>`);
    } else if (judgmentActive) {
      lines.push(`<b style="color:#ff5b6e">¡Juicio Legendario activo!</b>`);
    }

    const R = NS && NS.Rift;
    const activeRift = R && R.rift;

    if (activeRift && activeRift.active) {
      lines.push(`Grieta abierta - cierra en <b>${formatClockSec(activeRift.life || 0)}</b>`);
    } else if (judgmentActive || (judgmentAt - runSec) <= RIFT_CUTOFF) {
      // Sin más grietas cerca de Legendarios
    } else if (runSec <= RIFT_FROM) {
      lines.push(`Primera grieta posible en <b>${formatClockSec(RIFT_FROM + RIFT_EVERY - runSec)}</b>`);
    } else {
      const bossAlive = Boolean(NS && NS.EnemyMgr && NS.EnemyMgr.bossAlive && NS.EnemyMgr.bossAlive());
      if (bossAlive) {
        lines.push(`Grietas en pausa: hay un jefe vivo`);
      } else {
        const chance = Math.min(100, Math.round((0.35 + riftState.fails * 0.22) * 100));
        const rem = Math.max(0, 3 - riftState.fails);
        const sure = riftState.timer + rem * RIFT_EVERY;
        lines.push(
          chance >= 100
            ? `Grieta segura en <b>${formatClockSec(riftState.timer)}</b>`
            : `Grieta: tirada en <b>${formatClockSec(riftState.timer)}</b> (${chance} %) - segura en <b>${formatClockSec(sure)}</b>`
        );
      }
    }

    return lines.map(l => `<div>${l}</div>`).join('');
  }

  const BUFF_NAMES = {
    xpmagnet: 'Imán XP',
    frenzy: 'Frenesí',
    CritBoost: 'Crítico+',
    Haste: 'Prisa'
  };

  function buildBuffsHtml() {
    const NS = gameNS || window.__psmNS;
    const p = getEngineLocalPlayer();
    if (!p) {
      return '<div class="psm-empty-msg">Inicia combate para inspeccionar multiplicadores detallados.</div>';
    }

    const stats = [
      ['Daño', `×${formatDecEs(p.atkMul || 1)}`],
      ['Recarga', formatPctMultiplier(p.cdMul || 1)],
      ['Velocidad', formatPctMultiplier(p.spdMul || 1)],
      ['Reducción de daño', `${Math.round((p.reduction || 0) * 100)} %`],
      ['Regeneración', `${formatDecEs(p.regen || 0, 1)} vida/s`],
      [`Críticos (×${formatDecEs(p.critMul || 1.5, 1)})`, `${Math.round((p.critChance || 0) * 100)} %`],
      ['Imán', formatPctMultiplier((p.magnet || 78) / 78)],
      ['Experiencia', formatPctMultiplier(p.xpMul || 1)]
    ];

    const rows = ['<h4>Tus Mejoras</h4>'];
    for (const [k, v] of stats) {
      rows.push(`<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`);
    }

    if (p.buffs) {
      for (const k in p.buffs) {
        const b = p.buffs[k];
        const meta = BUFF_META[k];
        const bName = (meta && meta.label) || BUFF_NAMES[k] || k;
        if (b && typeof b === 'object') {
          if ((b.n || 0) > 0) {
            const tPart = b.t > 0 ? ` (${Math.ceil(b.t)} s)` : '';
            rows.push(`<div class="kv"><span>⚡ ${escapeHtml(bName)}</span><b>×${b.n}${escapeHtml(tPart)}</b></div>`);
          }
        } else if (typeof b === 'number' && b > 0) {
          rows.push(`<div class="kv"><span>⚡ ${escapeHtml(bName)}</span><b>${Math.ceil(b)} s</b></div>`);
        }
      }
    }

    if (p.power && p.power.t > 0) {
      const pName = (p.power.def && p.power.def.name) || 'Poder';
      rows.push(`<div class="kv"><span>🌟 ${escapeHtml(pName)}</span><b>${Math.ceil(p.power.t)} s</b></div>`);
    }

    if (p.item && NS && NS.Items && NS.Items.BY && NS.Items.BY[p.item]) {
      const it = NS.Items.BY[p.item];
      rows.push(`<div class="kv"><span>🎒 ${escapeHtml(it.name)}</span><b>${escapeHtml(it.rarity || '')}</b></div>`);
    }

    const coopActive = Boolean(NS && NS.Coop && NS.Coop.active);
    if (coopActive) {
      const others = (NS.Coop.players ? NS.Coop.players() : []).filter(u => u && u !== p);
      if (others.length) {
        rows.push('<h4>Equipo</h4>');
        for (const u of others) {
          const tag = u.tagColor || '#7fe0ff';
          const parts = [`Nv.${u.level || 1}`];
          if (u.atkMul && u.atkMul !== 1) parts.push(`Daño ×${formatDecEs(u.atkMul)}`);
          if (u.critChance) parts.push(`Crít ${Math.round(u.critChance * 100)}%`);
          if (u.reduction) parts.push(`Red ${Math.round(u.reduction * 100)}%`);
          if (u.item && NS.Items && NS.Items.BY && NS.Items.BY[u.item]) {
            parts.push(NS.Items.BY[u.item].name);
          }
          rows.push(
            `<div class="kv"><span style="color:${tag}">${escapeHtml(u.nick || u.name || 'Aliado')}</span><b>${escapeHtml(parts.join(' · '))}</b></div>`
          );
        }
      }
    }

    return rows.join('');
  }

  function buildPlayerRowsHtml(currentDps) {
    const coopEntries = getCoopPlayerEntries();
    const engineMoves = getEngineMoveBreakdown();

    if (!coopEntries || coopEntries.length === 0) return '';

    const elapsed = Math.max(1, getEngineRunSeconds());
    let sumDmg = 0;
    for (const e of coopEntries) sumDmg += (e.dmg || 0);
    sumDmg = Math.max(1, sumDmg);

    const rowsHtml = [];
    for (const e of coopEntries) {
      const dmgVal = e.dmg || 0;
      const pct = Math.round((dmgVal / sumDmg) * 100);
      const pDps = e.me ? currentDps : Math.round(dmgVal / elapsed);

      let hpBarHtml = '';
      if (e.dead) {
        hpBarHtml = `<div class="psm-pl-sub"><span class="psm-pl-dead">⚠ Caído - ve a revivirlo</span></div>`;
      }

      let movesSubHtml = '';
      if (e.me && showOwnMovesInRow && engineMoves.length > 0) {
        const mvItems = engineMoves.slice(0, 6).map(m => {
          const mPct = Math.round((m.pct || 0) * 100);
          return `
            <div class="psm-pl-mv">
              <span>${m.evolved ? '★ ' : ''}${escapeHtml(m.name)}</span>
              <span>${formatNumber(m.dmg)}</span>
              <span>${mPct}%</span>
            </div>
          `;
        }).join('');
        movesSubHtml = `<div class="psm-pl-moves">${mvItems}</div>`;
      }

      rowsHtml.push(`
        <div class="psm-pl-row ${e.me ? 'me' : ''}" title="${e.me ? 'Clic para mostrar/ocultar el desglose por ataque' : ''}">
          <div class="psm-pl-bar" style="width:${pct}%;background:${e.color || '#ffd23f'}"></div>
          <div class="psm-pl-line">
            <span class="psm-pl-name" style="color:${e.color || '#ffd23f'}">${escapeHtml(e.name)}${!e.exact && !e.me ? ' ~' : ''}</span>
            <span class="psm-pl-dmg">${formatNumber(dmgVal)}</span>
          </div>
          <div class="psm-pl-sub">
            <span>${formatNumber(pDps)} DPS</span>
            <span>${pct} %</span>
          </div>
          ${hpBarHtml}
          ${movesSubHtml}
        </div>
      `);
    }

    return rowsHtml.join('');
  }

  function renderStatsUI() {
    tickEngineClockAndXp();
    const dps = getCurrentDPS();
    const p = getEngineLocalPlayer();
    if (p && p.level && p.level > currentLevel) {
      currentLevel = p.level;
    }
    if (p && p.mon && p.mon.name && !companionName) {
      companionName = p.mon.name;
    } else if (p && p.poke && p.poke.name && !companionName) {
      companionName = p.poke.name;
    }

    const runSec = getEngineRunSeconds();
    if (elRunClock) elRunClock.textContent = formatClockSec(runSec);
    if (elDpsLive) elDpsLive.textContent = `${formatNumber(dps)} DPS`;
    if (elTimersInfo) {
      elTimersInfo.innerHTML = buildTimersInfoHtml();
    }
    if (elPlayerRows) {
      elPlayerRows.innerHTML = buildPlayerRowsHtml(dps);
    }

    if (!showBuffsPanel) {
      if (elExpandableSection) elExpandableSection.hidden = true;
      return;
    }

    if (elExpandableSection) elExpandableSection.hidden = false;

    if (elBuffsPanel) {
      elBuffsPanel.innerHTML = buildBuffsHtml();
    }

    if (elStMaxDps) elStMaxDps.textContent = formatNumber(maxDpsRecorded);
    if (elStMax) elStMax.textContent = formatNumber(maxSingleHit);
    if (elStAvg) elStAvg.textContent = totalHitsCount > 0 ? formatNumber(totalDamageDealt / totalHitsCount) : '0';
    if (elStHits) elStHits.textContent = formatNumber(totalHitsCount);
    if (elPokeHeader) elPokeHeader.textContent = companionName ? `Build · ${companionName}` : 'Build';
    if (elLvlBadge) elLvlBadge.textContent = `Nv. ${currentLevel}`;

    const validMoves = Array.from(activeMoves.values()).filter(m => m.title && m.title.trim().length > 0);
    const passivesSig = Array.from(passiveUpgrades.values())
      .map(u => `${u.title}:${u.count}:${u.totalVal}:${u.unit}`)
      .join('|');
    const movesSig = validMoves
      .map(m => `${m.title}:${m.count}:${m.bonded}:${m.bondOrder}:${m.bondedWith || ''}:${m.evolvedFrom || ''}`)
      .join('|');
    const itemSig = equippedItem ? `${equippedItem.name}:${equippedItem.desc}` : '';
    const buildSig = `${passivesSig}#${movesSig}#${itemSig}`;

    if (buildSig === lastRenderedBuildSig) return;
    lastRenderedBuildSig = buildSig;

    if (passiveUpgrades.size === 0) {
      elPassivesList.innerHTML = '<div class="psm-empty-msg">Sube de nivel para registrar Síntesis, Potencia, Imán…</div>';
    } else {
      elPassivesList.innerHTML = '';
      for (const upg of passiveUpgrades.values()) {
        const row = document.createElement('div');
        row.className = 'psm-upg-row';
        row.title = upg.desc || upg.title;

        let valFormatted = '';
        if (upg.hasNumeric) {
          const sign = upg.totalVal > 0 ? '+' : '';
          const rounded = Number.isInteger(upg.totalVal)
            ? upg.totalVal
            : parseFloat(upg.totalVal.toFixed(2));
          valFormatted = `${sign}${rounded}${upg.unit}`;
        }

        row.innerHTML = `
          <span class="psm-upg-name">${escapeHtml(upg.title)}</span>
          ${valFormatted ? `<span class="psm-upg-val">${escapeHtml(valFormatted)}</span>` : ''}
          <span class="psm-upg-count">x${upg.count}</span>
        `;
        elPassivesList.appendChild(row);
      }
    }

    if (validMoves.length === 0 && !equippedItem) {
      elMovesList.innerHTML = '<div class="psm-empty-msg">Tus ataques iniciales y mejoras saldrán aquí…</div>';
    } else {
      elMovesList.innerHTML = '';

      if (equippedItem) {
        const itemRow = document.createElement('div');
        itemRow.className = 'psm-upg-row psm-row-item';
        itemRow.title = equippedItem.desc;
        itemRow.innerHTML = `
          <span class="psm-upg-name" style="color:#ffe15a">🎒 ${escapeHtml(equippedItem.name)}</span>
          <span class="psm-upg-type">Objeto</span>
        `;
        elMovesList.appendChild(itemRow);
      }

      const sortedMoves = validMoves.sort((a, b) => {
        if (a.bonded && !b.bonded) return -1;
        if (!a.bonded && b.bonded) return 1;
        if (a.bonded && b.bonded) {
          return (a.bondOrder || 999) - (b.bondOrder || 999);
        }
        return b.count - a.count;
      });

      for (const mv of sortedMoves) {
        const row = document.createElement('div');
        row.className = `psm-upg-row ${mv.bonded ? 'psm-row-bonded' : ''}`;

        const evoNote = mv.evolvedFrom ? ` (Evolución de ${mv.evolvedFrom})` : '';
        const bondNote = mv.bondedWith ? ` · Unido con ${mv.bondedWith}` : '';
        row.title = `${mv.title}${evoNote}${bondNote}\n${mv.desc || ''}`.trim();

        const prefix = mv.bonded ? '🔗 ' : (mv.evolvedFrom ? '★ ' : '');
        const tagText = mv.bonded ? 'Vínculo' : (mv.typeTag || (mv.evolvedFrom ? 'Evo' : ''));

        row.innerHTML = `
          <span class="psm-upg-name">${prefix}${escapeHtml(mv.title)}</span>
          ${tagText ? `<span class="psm-upg-type">${escapeHtml(tagText)}</span>` : ''}
          <span class="psm-upg-count">Nv.${mv.count}</span>
        `;
        elMovesList.appendChild(row);
      }
    }
  }

  function formatRunShareText(run) {
    const lines = [];
    lines.push(`🏆 PokéSurvivor · Resumen de Partida (${run.date || ''})`);
    lines.push(`🐾 Pokémon: ${run.pokemon || 'Desconocido'} (Nv. ${run.level || 1})`);
    lines.push(`⏱️ Tiempo: ${run.timeStr || '00:00'} | 🔥 DPS Máx: ${formatNumber(run.maxDps || 0)} (Media: ${formatNumber(run.avgDps || 0)}/s)`);
    lines.push(`💥 Daño Total: ${formatNumber(run.totalDmg || 0)} | Golpe Máx: ${formatNumber(run.maxHit || 0)}`);
    lines.push(`💀 Derrotados: ${run.kills || 0} | 👑 Jefes: ${run.bosses || 0}`);

    if (run.item) {
      lines.push(`🎒 Objeto: ${run.item}`);
    }

    if (run.players && run.players.length > 1) {
      let sumP = 0;
      for (const pl of run.players) sumP += (pl.dmg || 0);
      sumP = Math.max(1, sumP);
      lines.push(`👥 Equipo Co-op:`);
      for (const pl of run.players) {
        const pct = Math.round(((pl.dmg || 0) / sumP) * 100);
        lines.push(`  • ${pl.nick}: ${formatNumber(pl.dmg || 0)} (${pct}%)`);
      }
    }

    if (run.moves && run.moves.length > 0) {
      let sumM = 0;
      for (const m of run.moves) sumM += (m.damage || 0);
      lines.push(`⚔️ Habilidades:`);
      for (const m of run.moves) {
        const pct = sumM > 0 ? Math.round(((m.damage || 0) / sumM) * 100) : 0;
        const prefix = m.bonded ? '🔗 ' : (m.evolvedFrom ? '★ ' : '• ');
        const dmgPart = m.damage > 0 ? ` — ${formatNumber(m.damage)} (${pct}%)` : '';
        lines.push(`  ${prefix}${m.title} (Nv.${m.count || 1})${dmgPart}`);
      }
    }

    if (run.passives && run.passives.length > 0) {
      const pList = run.passives.map(p => `${p.title}${p.valStr ? ` ${p.valStr}` : ''} (x${p.count})`).join(', ');
      lines.push(`✨ Pasivas: ${pList}`);
    }

    return lines.join('\n');
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
    }
    return Promise.resolve(fallbackCopyText(text));
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  function renderHistoryUI() {
    elHistCount.textContent = `${runHistory.length} ${runHistory.length === 1 ? 'run' : 'runs'}`;

    let bestTimeSec = 0;
    let bestTimeStr = '--:--';
    let bestDps = 0;
    let bestKills = 0;

    for (const r of runHistory) {
      if ((r.timeSec || 0) > bestTimeSec) {
        bestTimeSec = r.timeSec;
        bestTimeStr = r.timeStr;
      }
      if ((r.maxDps || 0) > bestDps) bestDps = r.maxDps;
      if ((r.kills || 0) > bestKills) bestKills = r.kills;
    }

    elRecTime.textContent = bestTimeStr;
    elRecDps.textContent = formatNumber(bestDps);
    elRecKills.textContent = formatNumber(bestKills);

    if (runHistory.length === 0) {
      elHistList.innerHTML = '<div class="psm-empty-msg">Tus partidas se guardarán aquí automáticamente al terminar o abandonar una run.</div>';
      return;
    }

    elHistList.innerHTML = '';

    for (const run of runHistory) {
      const card = document.createElement('div');
      card.className = 'psm-run-card';

      let runMoveTotalDmg = 0;
      for (const m of (run.moves || [])) runMoveTotalDmg += (m.damage || 0);

      const itemHTML = run.item
        ? `<div class="psm-upg-row psm-row-item" style="margin-bottom:4px"><span class="psm-upg-name" style="color:#ffe15a">🎒 ${escapeHtml(run.item)}</span><span class="psm-upg-type">Objeto</span></div>`
        : '';

      let coopPlayersHTML = '';
      if (run.players && run.players.length > 1) {
        let sumP = 0;
        for (const pl of run.players) sumP += (pl.dmg || 0);
        sumP = Math.max(1, sumP);
        coopPlayersHTML = `<div class="psm-hist-sub">Jugadores (Co-op)</div>` + run.players.map(pl => {
          const pct = Math.round(((pl.dmg || 0) / sumP) * 100);
          return `
            <div class="psm-upg-row" style="margin-bottom:3px">
              <div class="psm-dmg-bar" style="width:${pct}%"></div>
              <span class="psm-upg-name"><i class="psm-player-dot" style="background:${escapeHtml(pl.color || '#ffd23f')};display:inline-block;margin-right:5px"></i>${escapeHtml(pl.nick)}</span>
              <span class="psm-upg-dmg">${formatNumber(pl.dmg || 0)} (${pct}%)</span>
            </div>
          `;
        }).join('');
      }

      const movesHTML = (run.moves && run.moves.length > 0)
        ? run.moves.map(m => {
            const pct = runMoveTotalDmg > 0 ? Math.round(((m.damage || 0) / runMoveTotalDmg) * 100) : 0;
            const prefix = m.bonded ? '🔗 ' : (m.evolvedFrom ? '★ ' : '');
            const dmgText = m.damage > 0 ? `<span class="psm-upg-dmg">${formatNumber(m.damage)} (${pct}%)</span>` : '';
            return `
              <div class="psm-upg-row ${m.bonded ? 'psm-row-bonded' : ''}" style="margin-bottom:3px">
                <div class="psm-dmg-bar" style="width:${pct}%"></div>
                <span class="psm-upg-name">${prefix}${escapeHtml(m.title)}</span>
                ${dmgText}
                <span class="psm-upg-count">Nv.${m.count}</span>
              </div>
            `;
          }).join('')
        : '<div class="psm-empty-msg" style="padding:4px">Sin movimientos registrados</div>';

      const passivesHTML = (run.passives && run.passives.length > 0)
        ? run.passives.map(p => `
            <div class="psm-upg-row" style="margin-bottom:3px">
              <span class="psm-upg-name">${escapeHtml(p.title)}</span>
              ${p.valStr ? `<span class="psm-upg-val">${escapeHtml(p.valStr)}</span>` : ''}
              <span class="psm-upg-count">x${p.count}</span>
            </div>
          `).join('')
        : '<div class="psm-empty-msg" style="padding:4px">Sin pasivas registradas</div>';

      card.innerHTML = `
        <div class="psm-run-head" title="${escapeHtml(run.date)} · Clic para desplegar la build completa">
          <span class="psm-run-poke">${escapeHtml(run.pokemon)}</span>
          <span class="psm-run-meta">⏱️ ${escapeHtml(run.timeStr)} · Nv.${run.level} · 💀 ${run.kills || 0}</span>
          <span class="psm-run-dps">🔥 ${formatNumber(run.maxDps || 0)} DPS</span>
          <div class="psm-run-actions">
            <button class="psm-run-share" type="button" title="Copiar resumen de la partida al portapapeles">📋 Compartir</button>
            <button class="psm-run-del" type="button" title="Borrar esta run">×</button>
          </div>
        </div>
        <div class="psm-run-details">
          <div style="display:flex;justify-content:space-between;color:#8fa3c2;margin-bottom:6px;font-size:10px">
            <span>📅 ${escapeHtml(run.date)}</span>
            <span>💀 ${run.kills || 0} derrotados · 👑 ${run.bosses || 0} jefes · 💥 Golpe Máx ${formatNumber(run.maxHit || 0)}</span>
          </div>
          ${itemHTML}
          ${coopPlayersHTML}
          <div class="psm-hist-sub">Habilidades (Ordenadas por Daño)</div>
          ${movesHTML}
          <div class="psm-hist-sub">Pasivas Acumuladas</div>
          ${passivesHTML}
        </div>
      `;

      const headRow = card.querySelector('.psm-run-head');
      const shareBtn = card.querySelector('.psm-run-share');
      const delBtn = card.querySelector('.psm-run-del');

      headRow.addEventListener('click', e => {
        if (e.target.closest('.psm-run-actions')) return;
        card.classList.toggle('expanded');
      });

      shareBtn.addEventListener('click', e => {
        e.stopPropagation();
        const summaryText = formatRunShareText(run);
        copyTextToClipboard(summaryText).then(() => {
          shareBtn.textContent = '✅ ¡Copiado!';
          shareBtn.classList.add('copied');
          setTimeout(() => {
            shareBtn.textContent = '📋 Compartir';
            shareBtn.classList.remove('copied');
          }, 1800);
        });
      });

      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        runHistory = runHistory.filter(r => r.id !== run.id);
        saveHistoryToStorage();
        renderHistoryUI();
      });

      elHistList.appendChild(card);
    }
  }

  // ------------------------------------------------------------------
  // MOTOR DEL MAPA, CO-OP Y HOOKS DEL CANVAS
  // ------------------------------------------------------------------

  function inversePoint(context, screenX, screenY) {
    const matrix = context.getTransform();
    const det = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;

    const px = screenX - matrix.e;
    const py = screenY - matrix.f;

    return {
      x: (matrix.d * px - matrix.c * py) / det,
      y: (-matrix.b * px + matrix.a * py) / det
    };
  }

  function isWorldTransform(context) {
    const m = context.getTransform();
    return Math.abs(m.e) > 1 || Math.abs(m.f) > 1;
  }

  let playerMoveAngle = 0;
  let prevPlayerWorld = null;

  function updateCameraInfo(context) {
    centerWorld = inversePoint(context, gameCanvas.width / 2, gameCanvas.height / 2);
    if (!centerWorld) return;

    const engP = getEngineLocalPlayer();
    if (engP && typeof engP.moveAngle === 'number' && Number.isFinite(engP.moveAngle)) {
      playerMoveAngle = engP.moveAngle;
    } else if (prevPlayerWorld) {
      const dx = centerWorld.x - prevPlayerWorld.x;
      const dy = centerWorld.y - prevPlayerWorld.y;
      if (Math.hypot(dx, dy) > 1.2) {
        playerMoveAngle = Math.atan2(dy, dx);
      }
    }
    prevPlayerWorld = { x: centerWorld.x, y: centerWorld.y };

    const now = Date.now();
    if (now - lastTrailAt > 120) {
      trail.push({ x: centerWorld.x, y: centerWorld.y, t: now });
      if (trail.length > 800) trail.shift();
      lastTrailAt = now;
    }

    const width = gameCanvas.width;
    const height = gameCanvas.height;

    viewCorners = [
      inversePoint(context, 0, 0),
      inversePoint(context, width, 0),
      inversePoint(context, width, height),
      inversePoint(context, 0, height)
    ].filter(Boolean);

    if (viewCorners.length === 4) {
      const xs = viewCorners.map(p => p.x);
      const ys = viewCorners.map(p => p.y);
      viewBounds = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      };
    }
  }

  function isInsideCurrentView(x, y, margin = -28) {
    if (!viewBounds) return false;
    return (
      x >= viewBounds.minX - margin &&
      x <= viewBounds.maxX + margin &&
      y >= viewBounds.minY - margin &&
      y <= viewBounds.maxY + margin
    );
  }

  function recordAllyExploredArea(x, y) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${cx},${cy}`;
    if (!chunks.has(key) && !allyExploredZones.has(key)) {
      allyExploredZones.set(key, {
        x: cx * CHUNK,
        y: cy * CHUNK
      });
    }
  }

  function isInsideKnownAllyBox(x, y) {
    for (const ally of alliesByName.values()) {
      const refX = ally.textX !== undefined ? ally.textX : ally.x;
      const refY = ally.textY !== undefined ? ally.textY : (ally.y - 32);
      const dx = Math.abs(x - refX);
      const dy = y - refY;
      if (dx < 75 && dy >= -35 && dy <= 115) {
        return true;
      }
    }
    return false;
  }

  let entityIdSeq = 1;
  function trackEntity(x, y, type) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const now = Date.now();

    let bestKey = null;
    let bestDist = 55;

    for (const [k, ent] of trackedEntities) {
      if (ent.frame === frameId && ent.type === type) continue;
      const d = Math.hypot(ent.x - x, ent.y - y);
      if (d < bestDist) {
        bestDist = d;
        bestKey = k;
      }
    }

    if (bestKey !== null) {
      const ent = trackedEntities.get(bestKey);
      const dt = now - ent.lastSeen;
      const dist = Math.hypot(x - ent.x, y - ent.y);

      if (dt > 0 && dt < 1200 && dist > 0.4) {
        const vx = (x - ent.x) / dist;
        const vy = (y - ent.y) / dist;
        ent.vx = ent.vx ? ent.vx * 0.55 + vx * 0.45 : vx;
        ent.vy = ent.vy ? ent.vy * 0.55 + vy * 0.45 : vy;
      }

      ent.x = x;
      ent.y = y;
      if (type === 'boss') ent.type = 'boss';
      ent.lastSeen = now;
      ent.frame = frameId;
      return bestKey;
    } else {
      const key = entityIdSeq++;
      trackedEntities.set(key, {
        x,
        y,
        vx: 0,
        vy: 0,
        type,
        lastSeen: now,
        frame: frameId
      });

      if (trackedEntities.size > 1200) {
        for (const [oldK, oldEnt] of trackedEntities) {
          if (oldEnt.type !== 'boss') {
            trackedEntities.delete(oldK);
            break;
          }
        }
      }
      return key;
    }
  }

  function upsertSpatialMap(collection, x, y, type, cell = 18, maxLimit = 1500) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const key = `${Math.round(x / cell)},${Math.round(y / cell)},${type}`;
    collection.set(key, { x, y, type, frame: frameId, lastSeen: Date.now() });

    if (collection.size > maxLimit) {
      collection.delete(collection.keys().next().value);
    }
    return key;
  }

  function classifyCanvasProp(w, h) {
    const dim = `${w}x${h}`;
    if (dim === '16x14') return 'chest';
    if (dim === '24x20') return 'bigchest';
    if (dim === '18x27') return 'altar';
    if (dim === '34x16') return 'spring';
    if (dim === '14x14') return 'trap';
    return 'object';
  }

  function observeDraw(image, args, context) {
    if (!activeRun || !image) return;

    const isChunk =
      image.tagName === 'CANVAS' &&
      image.width === 256 &&
      image.height === 256 &&
      args.length === 4 &&
      Math.abs(args[2] - 513) <= 2 &&
      Math.abs(args[3] - 513) <= 2;

    if (isChunk) {
      updateCameraInfo(context);
      const chunkX = Math.round(args[0] / CHUNK);
      const chunkY = Math.round(args[1] / CHUNK);
      const cKey = `${chunkX},${chunkY}`;

      chunks.set(cKey, {
        image,
        x: chunkX * CHUNK,
        y: chunkY * CHUNK
      });

      allyExploredZones.delete(cKey);

      while (chunks.size > 1600) {
        chunks.delete(chunks.keys().next().value);
      }
      return;
    }

    if (!Number.isFinite(args[0]) || !Number.isFinite(args[1])) return;

    const imageSrc = image.currentSrc || image.src || '';

    if (
      args.length === 8 &&
      ((image.tagName === 'IMG' && /\/assets\/pokemon\//i.test(imageSrc)) ||
       (args[2] >= 20 && args[3] >= 20 && args[6] >= 24 && args[7] >= 24))
    ) {
      const x = args[4] + args[6] / 2;
      const y = args[5] + args[7] * 0.92;

      if (centerWorld && Math.hypot(x - centerWorld.x, y - centerWorld.y) < 42) {
        return;
      }

      if (isInsideKnownAllyBox(x, y)) {
        lastPokemonDraw = null;
        return;
      }

      const key = trackEntity(x, y, 'pokemon');
      lastPokemonDraw = { x, y, key };
      return;
    }

    if (
      image.tagName === 'CANVAS' &&
      image.width > 0 &&
      image.width <= 60 &&
      image.height > 0 &&
      image.height <= 60 &&
      args.length === 4 &&
      args[2] > 4 &&
      args[3] > 4
    ) {
      const type = classifyCanvasProp(image.width, image.height);
      const x = args[0] + args[2] / 2;
      const y = (type === 'spring' || type === 'trap')
        ? args[1] + args[3] / 2 + 8
        : args[1] + args[3] * 0.92;

      if (type === 'object') {
        upsertSpatialMap(rememberedObjects, x, y, type, 22, 1200);
      } else {
        upsertSpatialMap(permanentProps, x, y, type, 14, 2000);
      }
    }
  }

  function recordFloatingDamage(val, worldX, worldY, fillStyle) {
    const color = String(fillStyle || '').toLowerCase();
    if (color.includes('5fe08a') || color.includes('0,255') || color.includes('42e5d2')) {
      return;
    }

    const now = Date.now();

    for (let i = activeFloatingTexts.length - 1; i >= 0; i--) {
      if (now - activeFloatingTexts[i].bornAt > 1500 || frameId - activeFloatingTexts[i].lastFrame > 8) {
        activeFloatingTexts.splice(i, 1);
      }
    }

    for (const ft of activeFloatingTexts) {
      if (
        ft.val === val &&
        Math.abs(worldX - ft.x) < 18 &&
        Math.abs(worldY - ft.y) < 28
      ) {
        ft.x = worldX;
        ft.y = worldY;
        ft.lastFrame = frameId;
        return;
      }
    }

    activeFloatingTexts.push({
      val,
      x: worldX,
      y: worldY,
      lastFrame: frameId,
      bornAt: now
    });

    damageEvents.push({ dmg: val, t: now });
    totalDamageDealt += val;
    totalHitsCount += 1;
    if (val > maxSingleHit) maxSingleHit = val;

    distributeDamageAcrossMoves(val);
    getCurrentDPS();
  }

  function recordAllyByNick(nick, textX, textY) {
    const lower = nick.toLowerCase();
    if (localPlayerNick && lower === localPlayerNick) return;

    if (centerWorld && Math.hypot(textX - centerWorld.x, (textY + 32) - centerWorld.y) < 48) {
      return;
    }

    const allyX = textX;
    const allyY = textY + 32;

    for (const [k, ent] of trackedEntities) {
      const dx = Math.abs(ent.x - textX);
      const dy = ent.y - textY;
      if (dx < 75 && dy >= -35 && dy <= 115) {
        trackedEntities.delete(k);
      }
    }

    if (lastPokemonDraw) {
      const dx = Math.abs(lastPokemonDraw.x - textX);
      const dy = lastPokemonDraw.y - textY;
      if (dx < 75 && dy >= -35 && dy <= 115) {
        lastPokemonDraw = null;
      }
    }

    const now = Date.now();
    const prev = alliesByName.get(lower);
    if (prev) {
      const dist = Math.hypot(allyX - prev.x, allyY - prev.y);
      if (dist > 0.5 && now - prev.lastSeen < 1200) {
        const vx = (allyX - prev.x) / dist;
        const vy = (allyY - prev.y) / dist;
        prev.vx = prev.vx ? prev.vx * 0.55 + vx * 0.45 : vx;
        prev.vy = prev.vy ? prev.vy * 0.55 + vy * 0.45 : vy;
      }
      prev.x = allyX;
      prev.y = allyY;
      prev.textX = textX;
      prev.textY = textY;
      prev.lastSeen = now;
    } else {
      alliesByName.set(lower, {
        name: nick,
        x: allyX,
        y: allyY,
        textX,
        textY,
        vx: 0,
        vy: 0,
        lastSeen: now
      });
    }

    recordAllyExploredArea(allyX, allyY);
  }

  function getNativeHudSafeOffsets() {
    try {
      const NS = gameNS || window.__psmNS;
      if (NS && NS.Touch && typeof NS.Touch.safeArea === 'function') {
        const sa = NS.Touch.safeArea();
        if (sa) return { left: sa.left || 0, top: sa.top || 0 };
      }
    } catch (_) {}
    return { left: 0, top: 0 };
  }

  // Detecta toda la esquina superior izquierda del HUD nativo (nombre, nivel, cápsula y barra de vida,
  // y píldoras/fondos oscuros de bufos y estados en X: [-10, 350], Y: [8, 130]),
  // excluyendo siempre la barra de XP de ancho completo (y=0..7) y cualquier elemento del mundo.
  function isNativePlayerHudTarget(ctx, x, y, w = 0, h = 0) {
    if (!activeRun || !ctx || isWorldTransform(ctx)) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const bw = Number.isFinite(w) ? Math.abs(w) : 0;
    const bh = Number.isFinite(h) ? Math.abs(h) : 0;
    if (bw > 350 || bh > 125) return false;
    if (y < 8 && bh <= 9) return false;
    const sa = getNativeHudSafeOffsets();
    const minX = -10;
    const maxX = 350 + sa.left;
    const minY = 8 + sa.top;
    const maxY = 130 + sa.top;
    return (
      x >= minX &&
      x <= maxX &&
      y >= minY &&
      y <= maxY &&
      (x + bw) <= maxX + 20 &&
      (y + bh) <= maxY + 15
    );
  }

  function captureCanvasBuffText(str, x, y, ctx) {
    if (!str || !ctx) return;
    const sa = getNativeHudSafeOffsets();
    if (x < 0 || x > 350 + sa.left || y < 48 + sa.top || y > 130 + sa.top) return;

    const stackMatch = str.match(/^([A-ZÁÉÍÓÚÑ.]+)\s*[×x](\d+)$/i);
    const timerMatch = !stackMatch ? str.match(/^(.+?)\s+(\d+)\s*s$/i) : null;
    if (!stackMatch && !timerMatch) return;

    const rawColor = String(ctx.fillStyle || '#7fe0ff');
    const color = /^#[0-9a-f]{3,8}$|^rgb/i.test(rawColor) ? rawColor : '#7fe0ff';

    if (stackMatch) {
      const prefix = stackMatch[1].toUpperCase();
      let icon = '⚡';
      if (prefix === 'ATK') icon = '⚔️';
      else if (prefix === 'AT.E') icon = '✨';
      else if (prefix === 'VEL') icon = '⚡';
      else if (prefix === 'DEF') icon = '🛡️';
      else if (prefix === 'REG') icon = '💚';
      canvasCapturedBuffs.set(prefix, {
        prefix,
        icon,
        label: `${prefix} ×${stackMatch[2]}`,
        timeStr: '',
        color,
        seenAt: performance.now()
      });
    } else if (timerMatch) {
      const prefix = timerMatch[1].trim().toUpperCase();
      if (/^(GRIETA|OLA|WAVE)$/i.test(prefix)) return;
      canvasCapturedBuffs.set(prefix, {
        prefix,
        icon: '🌟',
        label: prefix,
        timeStr: `${timerMatch[2]}s`,
        color,
        seenAt: performance.now()
      });
    }
  }

  const originalDrawImage = gameCtx.drawImage;
  const originalClearRect = gameCtx.clearRect;
  const originalFillRect = gameCtx.fillRect;
  const originalStrokeRect = gameCtx.strokeRect;
  const originalFillText = gameCtx.fillText;
  const originalStrokeText = gameCtx.strokeText;
  const originalBeginPath = gameCtx.beginPath;
  const originalClosePath = gameCtx.closePath;
  const originalMoveTo = gameCtx.moveTo;
  const originalLineTo = gameCtx.lineTo;
  const originalArcTo = gameCtx.arcTo;
  const originalRoundRect = gameCtx.roundRect;
  const originalRect = gameCtx.rect;
  const originalArc = gameCtx.arc;
  const originalFill = gameCtx.fill;
  const originalStroke = gameCtx.stroke;
  const originalClip = gameCtx.clip;

  try {
    gameCtx.drawImage = function(image, ...args) {
      try {
        observeDraw(image, args, this);
        if (!isWorldTransform(this)) {
          let dx = args[0];
          let dy = args[1];
          let dw = args[2] !== undefined ? args[2] : ((image && image.width) || 0);
          let dh = args[3] !== undefined ? args[3] : ((image && image.height) || 0);
          if (args.length >= 8) {
            dx = args[4];
            dy = args[5];
            dw = args[6];
            dh = args[7];
          }
          if (isNativePlayerHudTarget(this, dx, dy, dw, dh)) {
            return;
          }
        }
      } catch (_) {}
      return originalDrawImage.apply(this, [image, ...args]);
    };

    gameCtx.clearRect = function(x, y, width, height) {
      const matchesBufferSize = Math.abs(width - gameCanvas.width) < 4 && Math.abs(height - gameCanvas.height) < 4;
      const matchesClientSize = Math.abs(width - gameCanvas.clientWidth) < 4 && Math.abs(height - gameCanvas.clientHeight) < 4;
      if (
        activeRun &&
        x === 0 &&
        y === 0 &&
        (matchesBufferSize || matchesClientSize)
      ) {
        if (viewBounds) {
          for (const [k, ent] of trackedEntities) {
            if (ent.frame !== frameId && isInsideCurrentView(ent.x, ent.y, -35)) {
              trackedEntities.delete(k);
            }
          }
          for (const [k, obj] of rememberedObjects) {
            if (obj.frame !== frameId && isInsideCurrentView(obj.x, obj.y, -35)) {
              rememberedObjects.delete(k);
            }
          }
          for (const [k, prop] of permanentProps) {
            if (prop.frame !== frameId && isInsideCurrentView(prop.x, prop.y, -45)) {
              permanentProps.delete(k);
            }
          }
        }
        frameId++;
        lastPokemonDraw = null;
      }
      return originalClearRect.apply(this, arguments);
    };

    const BOSS_COLORS = new Set([
      '#ffcb3d', '#ffd23f', '#f2c443', '#ffc83d', '#ffcc00',
      'rgb(255,203,61)', 'rgb(255,210,63)'
    ]);

    gameCtx.fillRect = function(x, y, width, height) {
      try {
        const fill = String(this.fillStyle).toLowerCase().replace(/\s+/g, '');
        const isBossHealthBar =
          BOSS_COLORS.has(fill) &&
          height >= 2 && height <= 9 &&
          width > 0 && width <= 130;

        if (activeRun && isBossHealthBar && lastPokemonDraw && isWorldTransform(this)) {
          const barCenterX = x + width / 2;
          if (
            Math.abs(barCenterX - lastPokemonDraw.x) < 55 &&
            Math.abs(y - lastPokemonDraw.y) < 95 &&
            !isInsideKnownAllyBox(lastPokemonDraw.x, lastPokemonDraw.y)
          ) {
            const ent = trackedEntities.get(lastPokemonDraw.key);
            if (ent) ent.type = 'boss';
          }
          lastPokemonDraw = null;
        }

        if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, width, height)) {
          return;
        }
      } catch (_) {}
      return originalFillRect.apply(this, arguments);
    };

    if (typeof originalStrokeRect === 'function') {
      gameCtx.strokeRect = function(x, y, width, height) {
        try {
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, width, height)) {
            return;
          }
        } catch (_) {}
        return originalStrokeRect.apply(this, arguments);
      };
    }

    if (typeof originalBeginPath === 'function') {
      gameCtx.beginPath = function() {
        this.__psmSuppressPath = false;
        return originalBeginPath.apply(this, arguments);
      };
    }

    if (typeof originalMoveTo === 'function') {
      gameCtx.moveTo = function(x, y) {
        try {
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, 0, 0)) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalMoveTo.apply(this, arguments);
      };
    }

    if (typeof originalLineTo === 'function') {
      gameCtx.lineTo = function(x, y) {
        try {
          if (!isWorldTransform(this) && (this.__psmSuppressPath || isNativePlayerHudTarget(this, x, y, 0, 0))) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalLineTo.apply(this, arguments);
      };
    }

    if (typeof originalArcTo === 'function') {
      gameCtx.arcTo = function(x1, y1, x2, y2, r) {
        try {
          if (
            !isWorldTransform(this) &&
            (this.__psmSuppressPath || isNativePlayerHudTarget(this, x1, y1, 0, 0) || isNativePlayerHudTarget(this, x2, y2, 0, 0))
          ) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalArcTo.apply(this, arguments);
      };
    }

    if (typeof originalRoundRect === 'function') {
      gameCtx.roundRect = function(x, y, w, h) {
        try {
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, w, h)) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalRoundRect.apply(this, arguments);
      };
    }

    if (typeof originalRect === 'function') {
      gameCtx.rect = function(x, y, w, h) {
        try {
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, w, h)) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalRect.apply(this, arguments);
      };
    }

    if (typeof originalArc === 'function') {
      gameCtx.arc = function(x, y, r) {
        try {
          const rad = Number.isFinite(r) ? Math.abs(r) : 0;
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x - rad, y - rad, rad * 2, rad * 2)) {
            this.__psmSuppressPath = true;
            return;
          }
        } catch (_) {}
        return originalArc.apply(this, arguments);
      };
    }

    if (typeof originalClosePath === 'function') {
      gameCtx.closePath = function() {
        try {
          if (this.__psmSuppressPath && !isWorldTransform(this)) {
            return;
          }
        } catch (_) {}
        return originalClosePath.apply(this, arguments);
      };
    }

    if (typeof originalFill === 'function') {
      gameCtx.fill = function() {
        try {
          if (this.__psmSuppressPath && !isWorldTransform(this)) {
            return;
          }
        } catch (_) {}
        return originalFill.apply(this, arguments);
      };
    }

    if (typeof originalStroke === 'function') {
      gameCtx.stroke = function() {
        try {
          if (this.__psmSuppressPath && !isWorldTransform(this)) {
            return;
          }
        } catch (_) {}
        return originalStroke.apply(this, arguments);
      };
    }

    if (typeof originalClip === 'function') {
      gameCtx.clip = function() {
        try {
          if (this.__psmSuppressPath && !isWorldTransform(this)) {
            return;
          }
        } catch (_) {}
        return originalClip.apply(this, arguments);
      };
    }

    gameCtx.fillText = function(text, x, y, ...rest) {
      try {
        if (text !== undefined && text !== null) {
          const str = String(text).trim();
          if (isWorldTransform(this)) {
            if (activeRun) {
              if (/^\d{1,5}[!crit]*$/i.test(str)) {
                const val = parseInt(str, 10);
                if (Number.isFinite(val) && val > 0 && val < 99999) {
                  recordFloatingDamage(val, x, y, this.fillStyle);
                }
              } else if (
                str.length >= 2 &&
                str.length <= 18 &&
                /^[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ-]+$/.test(str) &&
                /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(str) &&
                !/^(crit|miss|fallo|bloqueo|inmune|nv\.?\s*\d+|lv\.?\s*\d+)$/i.test(str)
              ) {
                recordAllyByNick(str, x, y);
              }
            }
          } else {
            if (activeRun) {
              inspectCanvasHudTextForStarterMoves(str, x, y, this);
              captureCanvasBuffText(str, x, y, this);
            }
            if (isNativePlayerHudTarget(this, x, y, 0, 0)) {
              return;
            }
          }
        }
      } catch (_) {}
      return originalFillText.apply(this, [text, x, y, ...rest]);
    };

    if (typeof originalStrokeText === 'function') {
      gameCtx.strokeText = function(text, x, y, ...rest) {
        try {
          if (!isWorldTransform(this) && isNativePlayerHudTarget(this, x, y, 0, 0)) {
            return;
          }
        } catch (_) {}
        return originalStrokeText.apply(this, [text, x, y, ...rest]);
      };
    }
  } catch (error) {
    statusLeft.textContent = 'No se pudo conectar al canvas.';
    console.error('[PS Minimap] Error al conectar al canvas:', error);
    return;
  }

  function getMapViewCenter() {
    if (!centerWorld) return null;
    return {
      x: centerWorld.x + panOffset.x,
      y: centerWorld.y + panOffset.y
    };
  }

  function worldToMap(x, y) {
    const viewCenter = getMapViewCenter();
    if (!viewCenter) return null;
    const effR = getEffectiveMapRadius();
    const scale = SIZE / (effR * 2);
    return {
      x: SIZE / 2 + (x - viewCenter.x) * scale,
      y: SIZE / 2 + (y - viewCenter.y) * scale
    };
  }

  function inBounds(x, y, pad = 6) {
    return x >= -pad && y >= -pad && x <= SIZE + pad && y <= SIZE + pad;
  }

  function clampToMapEdge(worldX, worldY) {
    const viewCenter = getMapViewCenter();
    if (!viewCenter) return null;
    const effR = getEffectiveMapRadius();
    const scale = SIZE / (effR * 2);
    const dx = (worldX - viewCenter.x) * scale;
    const dy = (worldY - viewCenter.y) * scale;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    const lim = SIZE / 2 - 7;
    const k = m > lim ? lim / m : 1;
    return {
      x: SIZE / 2 + dx * k,
      y: SIZE / 2 + dy * k,
      clamped: m > lim
    };
  }

  function drawDot(x, y, color, radius = 2, alpha = 1) {
    if (!inBounds(x, y)) return;
    mapCtx.save();
    mapCtx.globalAlpha = alpha;
    mapCtx.beginPath();
    mapCtx.arc(x, y, radius, 0, Math.PI * 2);
    mapCtx.fillStyle = color;
    mapCtx.fill();
    mapCtx.restore();
  }

  function drawBorderedSquare(x, y, r, color) {
    if (!inBounds(x, y, r + 4)) return;
    mapCtx.fillStyle = '#0b1838';
    mapCtx.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
    mapCtx.fillStyle = color;
    mapCtx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawPokemonWithDir(x, y, vx, vy, isLive) {
    if (!inBounds(x, y)) return;
    const alpha = isLive ? 0.85 : 0.5;

    mapCtx.save();
    mapCtx.globalAlpha = alpha;

    if (vx || vy) {
      mapCtx.strokeStyle = '#ff9aa2';
      mapCtx.lineWidth = 1.1;
      mapCtx.beginPath();
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x + vx * 4.8, y + vy * 4.8);
      mapCtx.stroke();
    }

    mapCtx.beginPath();
    mapCtx.arc(x, y, 2.2, 0, Math.PI * 2);
    mapCtx.fillStyle = '#ff6675';
    mapCtx.fill();

    mapCtx.restore();
  }

  function drawAllyMarker(x, y, vx, vy, allyName, color = '#5fe08a', downed = false) {
    if (!visibility.ally || !inBounds(x, y, 14)) return;

    mapCtx.save();

    if (downed) {
      const pulse = 5 + Math.sin(performance.now() * 0.01) * 2;
      mapCtx.strokeStyle = '#ff3048';
      mapCtx.lineWidth = 1.8;
      mapCtx.beginPath();
      mapCtx.arc(x, y, pulse, 0, Math.PI * 2);
      mapCtx.stroke();
    } else if (vx || vy) {
      mapCtx.strokeStyle = '#a8ffcb';
      mapCtx.lineWidth = 1.2;
      mapCtx.beginPath();
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x + vx * 6, y + vy * 6);
      mapCtx.stroke();
    }

    const fillCol = downed ? '#ff3048' : (color || '#5fe08a');
    mapCtx.fillStyle = '#0b1838';
    mapCtx.beginPath();
    mapCtx.arc(x, y, 5.2, 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.fillStyle = fillCol;
    mapCtx.beginPath();
    mapCtx.arc(x, y, 3.8, 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.strokeStyle = '#ffffff';
    mapCtx.lineWidth = 1.2;
    mapCtx.beginPath();
    mapCtx.arc(x, y, 4.1, 0, Math.PI * 2);
    mapCtx.stroke();

    if (allyName) {
      mapCtx.font = 'bold 8.5px system-ui, sans-serif';
      mapCtx.fillStyle = downed ? '#ff8fa0' : '#d4ffe4';
      mapCtx.strokeStyle = '#0b1838';
      mapCtx.lineWidth = 2.2;
      mapCtx.textAlign = 'center';
      const label = allyName.slice(0, 12);
      mapCtx.strokeText(label, x, y - 6.5);
      mapCtx.fillText(label, x, y - 6.5);
    }

    mapCtx.restore();
  }

  function drawPropMarker(x, y, type) {
    if (!visibility[type] || !inBounds(x, y, 10)) return;

    if (type === 'chest') {
      drawBorderedSquare(x, y, 3.8, '#c98a3c');
      return;
    }
    if (type === 'bigchest') {
      drawBorderedSquare(x, y, 5.2, '#ffd23f');
      return;
    }

    mapCtx.save();
    mapCtx.translate(x, y);

    if (type === 'altar') {
      mapCtx.rotate(Math.PI / 4);
      mapCtx.fillStyle = '#7fe0ff';
      mapCtx.strokeStyle = '#0b1838';
      mapCtx.lineWidth = 1.6;
      mapCtx.fillRect(-3.3, -3.3, 6.6, 6.6);
      mapCtx.strokeRect(-3.3, -3.3, 6.6, 6.6);
    } else if (type === 'spring') {
      mapCtx.fillStyle = '#0b1838';
      mapCtx.fillRect(-1.8, -3.8, 3.6, 7.6);
      mapCtx.fillRect(-3.8, -1.8, 7.6, 3.6);
      mapCtx.fillStyle = '#42e5d2';
      mapCtx.fillRect(-1, -3, 2, 6);
      mapCtx.fillRect(-3, -1, 6, 2);
    } else if (type === 'trap') {
      mapCtx.rotate(Math.PI / 4);
      mapCtx.fillStyle = '#0b1838';
      mapCtx.fillRect(-1.6, -3.4, 3.2, 6.8);
      mapCtx.fillRect(-3.4, -1.6, 6.8, 3.2);
      mapCtx.fillStyle = '#a6ee55';
      mapCtx.fillRect(-0.9, -2.7, 1.8, 5.4);
      mapCtx.fillRect(-2.7, -0.9, 5.4, 1.8);
    }

    mapCtx.restore();
  }

  function drawBossMarker(x, y, vx, vy, isLive, variant = 'boss') {
    if (!visibility.boss || !inBounds(x, y, 12)) return;

    mapCtx.save();
    mapCtx.globalAlpha = isLive ? 1 : 0.85;

    if (vx || vy) {
      mapCtx.strokeStyle = '#fff2c0';
      mapCtx.lineWidth = 1.4;
      mapCtx.beginPath();
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x + vx * 7, y + vy * 7);
      mapCtx.stroke();
    }

    let fillCol = '#ff3048';
    let ringCol = '#ffffff';
    let rad = 5.5;

    if (variant === 'legend' || variant === 'judge') {
      fillCol = '#c47bff';
      ringCol = '#ffffff';
      rad = 5.8;
    } else if (variant === 'shiny') {
      fillCol = '#7fe0ff';
      ringCol = '#7fe0ff';
      rad = 4.6;
    } else if (variant === 'golden' || variant === 'thief') {
      fillCol = '#ffd23f';
      ringCol = '#0b1838';
      rad = 4.2;
    }

    if (variant === 'shiny') {
      const pulse = 5.2 + Math.sin(performance.now() * 0.008) * 1.6;
      mapCtx.strokeStyle = '#7fe0ff';
      mapCtx.lineWidth = 1.3;
      mapCtx.beginPath();
      mapCtx.arc(x, y, pulse, 0, Math.PI * 2);
      mapCtx.stroke();
    }

    mapCtx.fillStyle = '#0b1838';
    mapCtx.beginPath();
    mapCtx.arc(x, y, rad + 1.5, 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.fillStyle = fillCol;
    mapCtx.beginPath();
    mapCtx.arc(x, y, rad, 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.strokeStyle = ringCol;
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.arc(x, y, rad + 0.4, 0, Math.PI * 2);
    mapCtx.stroke();

    mapCtx.fillStyle = '#fff2c0';
    mapCtx.beginPath();
    mapCtx.arc(x, y, 1.6, 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.restore();
  }

  function drawPlayerArrow(x, y, angle, strokeColor = '#ffd23f') {
    if (!inBounds(x, y, 12)) return;
    mapCtx.save();
    mapCtx.translate(x, y);
    mapCtx.rotate(angle || 0);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.strokeStyle = strokeColor || '#ffd23f';
    mapCtx.lineWidth = 1.8;
    mapCtx.beginPath();
    mapCtx.moveTo(8, 0);
    mapCtx.lineTo(-5.5, -5.5);
    mapCtx.lineTo(-2.2, 0);
    mapCtx.lineTo(-5.5, 5.5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.stroke();
    mapCtx.restore();
  }

  let lastEngineWorldScanAt = 0;
  function syncEngineWorldMarkers(now) {
    const NS = gameNS || window.__psmNS;
    if (!NS || !NS.World || !centerWorld) return;
    if (now - lastEngineWorldScanAt < 420) return;
    lastEngineWorldScanAt = now;

    const scanR = Math.min(MAX_MAP_RADIUS, Math.max(2000, getEffectiveMapRadius() * 1.1));
    try {
      if (typeof NS.World.propsInCircle === 'function') {
        const props = NS.World.propsInCircle(centerWorld.x, centerWorld.y, scanR) || [];
        for (const pr of props) {
          if (!pr || (pr.kind !== 'chest' && pr.kind !== 'bigchest')) continue;
          const cellKey = `${Math.round(pr.x / 14)},${Math.round(pr.y / 14)},${pr.kind}`;
          if (pr.opened) {
            permanentProps.delete(cellKey);
          } else {
            permanentProps.set(cellKey, {
              x: pr.x,
              y: pr.y,
              type: pr.kind,
              frame: frameId,
              lastSeen: now,
              ref: pr
            });
          }
        }
      }
      if (typeof NS.World.specialsNear === 'function') {
        const spList = NS.World.specialsNear(centerWorld.x, centerWorld.y, scanR) || [];
        for (const s of spList) {
          if (!s) continue;
          const cellKey = `${Math.round(s.x / 14)},${Math.round(s.y / 14)},altar`;
          if (s.used) {
            permanentProps.delete(cellKey);
          } else {
            permanentProps.set(cellKey, {
              x: s.x,
              y: s.y,
              type: 'altar',
              frame: frameId,
              lastSeen: now,
              ref: s
            });
          }
        }
      }
    } catch (_) {}

    for (const [k, prop] of permanentProps.entries()) {
      if (prop.ref && (prop.ref.opened || prop.ref.used)) {
        permanentProps.delete(k);
      }
    }
  }

  const PICKUP_COLORS = {
    heal: '#5fe08a',
    xpmagnet: '#7fe0ff',
    frenzy: '#ff8a3d',
    pokeball: '#ff5b6e',
    coin: '#ffd23f'
  };

  let lastMapDrawAt = 0;
  function drawMap(force = false) {
    const perfNow = performance.now();
    if (!force && perfNow - lastMapDrawAt < 33) return;
    lastMapDrawAt = perfNow;

    mapCtx.clearRect(0, 0, SIZE, SIZE);
    mapCtx.fillStyle = '#0d1b3d';
    mapCtx.fillRect(0, 0, SIZE, SIZE);

    const viewCenter = getMapViewCenter();
    if (!activeRun || !centerWorld || !viewCenter) return;

    const now = Date.now();
    syncEngineWorldMarkers(now);

    while (trail.length && now - trail[0].t > 120000) {
      trail.shift();
    }

    const effRadius = getEffectiveMapRadius();
    const scale = SIZE / (effRadius * 2);
    const isWorldVisible = (wx, wy, pad = 48) =>
      Math.abs(wx - viewCenter.x) <= effRadius + pad &&
      Math.abs(wy - viewCenter.y) <= effRadius + pad;

    mapCtx.save();
    mapCtx.beginPath();
    mapCtx.rect(0, 0, SIZE, SIZE);
    mapCtx.clip();

    for (const z of allyExploredZones.values()) {
      if (!isWorldVisible(z.x + CHUNK / 2, z.y + CHUNK / 2, CHUNK / 2 + 16)) continue;
      const p = worldToMap(z.x, z.y);
      if (!p) continue;
      const side = CHUNK * scale;
      mapCtx.fillStyle = 'rgba(46, 85, 58, 0.45)';
      mapCtx.fillRect(p.x, p.y, side, side);
      mapCtx.strokeStyle = 'rgba(95, 224, 138, 0.16)';
      mapCtx.lineWidth = 0.8;
      mapCtx.strokeRect(p.x, p.y, side, side);
    }

    for (const chunk of chunks.values()) {
      const cx = chunk.x + CHUNK / 2;
      const cy = chunk.y + CHUNK / 2;

      if (!isWorldVisible(cx, cy, CHUNK / 2 + 16)) {
        continue;
      }

      const p = worldToMap(chunk.x, chunk.y);
      if (!p) continue;

      try {
        mapCtx.drawImage(chunk.image, p.x, p.y, CHUNK * scale, CHUNK * scale);
      } catch (_) {}
    }

    // Retícula sutil de referencia estilo PMD
    mapCtx.strokeStyle = 'rgba(127, 224, 255, 0.10)';
    mapCtx.lineWidth = 1;
    mapCtx.beginPath();
    mapCtx.arc(SIZE / 2, SIZE / 2, SIZE * 0.25, 0, Math.PI * 2);
    mapCtx.arc(SIZE / 2, SIZE / 2, SIZE * 0.45, 0, Math.PI * 2);
    mapCtx.moveTo(SIZE / 2, 0);
    mapCtx.lineTo(SIZE / 2, SIZE);
    mapCtx.moveTo(0, SIZE / 2);
    mapCtx.lineTo(SIZE, SIZE / 2);
    mapCtx.stroke();

    const NS = gameNS || window.__psmNS;

    // Evento de zona (círculo en el mapa si hay evento activo)
    if (NS && NS.Events && NS.Events.current) {
      const ev = NS.Events.current;
      if (ev.x != null && ev.y != null) {
        const ep = clampToMapEdge(ev.x, ev.y);
        if (ep) {
          mapCtx.strokeStyle = '#ffd23f';
          mapCtx.lineWidth = 1.6;
          mapCtx.beginPath();
          mapCtx.arc(ep.x, ep.y, Math.max(6, (ev.r || 120) * scale), 0, Math.PI * 2);
          mapCtx.stroke();
        }
      }
    }

    // Grieta Dimensional activa
    if (NS && NS.Rift && NS.Rift.rift && NS.Rift.rift.active) {
      const rf = NS.Rift.rift;
      const rp = clampToMapEdge(rf.x, rf.y);
      if (rp) {
        mapCtx.fillStyle = '#0b1838';
        mapCtx.beginPath();
        mapCtx.arc(rp.x, rp.y, 6.2, 0, Math.PI * 2);
        mapCtx.fill();
        mapCtx.strokeStyle = '#c47bff';
        mapCtx.lineWidth = 2.2;
        mapCtx.beginPath();
        mapCtx.arc(rp.x, rp.y, 4.8, 0, Math.PI * 2);
        mapCtx.stroke();
      }
    }

    if (visibility.player && trail.length > 1) {
      mapCtx.strokeStyle = 'rgba(112, 223, 255, .28)';
      mapCtx.lineWidth = 1;
      mapCtx.beginPath();
      let started = false;

      for (const pt of trail) {
        if (!isWorldVisible(pt.x, pt.y, 80)) {
          started = false;
          continue;
        }
        const p = worldToMap(pt.x, pt.y);
        if (!p || !inBounds(p.x, p.y, 20)) {
          started = false;
          continue;
        }
        if (!started) {
          mapCtx.moveTo(p.x, p.y);
          started = true;
        } else {
          mapCtx.lineTo(p.x, p.y);
        }
      }
      mapCtx.stroke();
    }

    if (viewCorners.length === 4) {
      mapCtx.beginPath();
      const first = worldToMap(viewCorners[0].x, viewCorners[0].y);
      mapCtx.moveTo(first.x, first.y);

      for (let i = 1; i < viewCorners.length; i++) {
        const p = worldToMap(viewCorners[i].x, viewCorners[i].y);
        mapCtx.lineTo(p.x, p.y);
      }

      mapCtx.closePath();
      mapCtx.strokeStyle = 'rgba(255,255,255,.65)';
      mapCtx.lineWidth = 1;
      mapCtx.stroke();
    }

    if (visibility.object) {
      if (NS && NS.Pickups && typeof NS.Pickups.all === 'function') {
        const pkList = NS.Pickups.all() || [];
        for (const pk of pkList) {
          if (!pk || pk.kind === 'xp') continue;
          const col = PICKUP_COLORS[pk.kind];
          if (!col || !isWorldVisible(pk.x, pk.y, 24)) continue;
          const p = worldToMap(pk.x, pk.y);
          if (p && inBounds(p.x, p.y)) {
            drawBorderedSquare(p.x, p.y, pk.kind === 'pokeball' ? 3.5 : 2.8, col);
          }
        }
      }
      for (const obj of rememberedObjects.values()) {
        if (!isWorldVisible(obj.x, obj.y, 24)) continue;
        const p = worldToMap(obj.x, obj.y);
        if (p) {
          const isLive = now - obj.lastSeen < 400;
          drawDot(p.x, p.y, '#f4b942', 1.9, isLive ? 1 : 0.65);
        }
      }
    }

    for (const prop of permanentProps.values()) {
      if (prop.ref && (prop.ref.opened || prop.ref.used)) continue;
      if (!isWorldVisible(prop.x, prop.y, 32)) continue;
      const p = worldToMap(prop.x, prop.y);
      if (p) drawPropMarker(p.x, p.y, prop.type);
    }

    // Enemigos y Jefes: lectura directa e infalible del motor + respaldo por canvas
    const hasEngineEnemies = Boolean(NS && NS.EnemyMgr && typeof NS.EnemyMgr.all === 'function');
    if (hasEngineEnemies) {
      const enemies = NS.EnemyMgr.all() || [];
      const specialList = [];
      for (const e of enemies) {
        if (!e || e.dead) continue;
        if (e.boss || e.legend || e.judge || e.shiny || e.golden || e.behavior === 'thief') {
          specialList.push(e);
          continue;
        }
        if (visibility.pokemon && isWorldVisible(e.x, e.y, 24)) {
          const p = worldToMap(e.x, e.y);
          if (p && inBounds(p.x, p.y)) {
            drawDot(p.x, p.y, '#ff5b6e', 1.8, 0.72);
          }
        }
      }

      for (const e of specialList) {
        const ep = clampToMapEdge(e.x, e.y);
        if (!ep) continue;
        let variant = 'boss';
        if (e.legend || e.judge) variant = 'legend';
        else if (e.shiny) variant = 'shiny';
        else if (e.golden || e.behavior === 'thief') variant = 'golden';
        drawBossMarker(ep.x, ep.y, 0, 0, true, variant);
      }
    } else {
      const bossesToDraw = [];
      for (const [k, ent] of trackedEntities.entries()) {
        if (isInsideKnownAllyBox(ent.x, ent.y)) {
          trackedEntities.delete(k);
          continue;
        }

        const isLive = now - ent.lastSeen < 350;
        if (ent.type === 'boss') {
          bossesToDraw.push({ ent, isLive });
        } else if (visibility.pokemon && isWorldVisible(ent.x, ent.y, 24)) {
          const p = worldToMap(ent.x, ent.y);
          if (p) drawPokemonWithDir(p.x, p.y, ent.vx, ent.vy, isLive);
        }
      }

      for (const { ent, isLive } of bossesToDraw) {
        const ep = clampToMapEdge(ent.x, ent.y);
        if (ep) drawBossMarker(ep.x, ep.y, ent.vx, ent.vy, isLive, 'boss');
      }
    }

    // Aliados Co-op: lectura directa de NS.Coop.players() + respaldo por nick en canvas
    const drawnAllyNicks = new Set();
    const localP = getEngineLocalPlayer();
    if (NS && NS.Coop && NS.Coop.active && typeof NS.Coop.players === 'function') {
      const coopList = NS.Coop.players() || [];
      for (const u of coopList) {
        if (!u || u === localP) continue;
        const allyName = u.nick || u.name || '';
        if (allyName) drawnAllyNicks.add(allyName.toLowerCase());
        recordAllyExploredArea(u.x, u.y);
        const ap = clampToMapEdge(u.x, u.y);
        if (ap) {
          drawAllyMarker(ap.x, ap.y, 0, 0, allyName || 'Aliado', u.tagColor || '#5fe08a', Boolean(u.downed || u.dead));
        }
      }
    }

    for (const [lowerNick, ally] of alliesByName.entries()) {
      if (drawnAllyNicks.has(lowerNick)) continue;
      const ap = clampToMapEdge(ally.x, ally.y);
      if (ap) drawAllyMarker(ap.x, ally.y, ally.vx, ally.vy, ally.name, '#5fe08a', false);
    }

    if (visibility.player) {
      const playerPos = worldToMap(centerWorld.x, centerWorld.y);
      if (playerPos && inBounds(playerPos.x, playerPos.y, 12)) {
        const strokeCol = (localP && localP.tagColor) || '#ffd23f';
        drawPlayerArrow(playerPos.x, playerPos.y, playerMoveAngle, strokeCol);
      }
    }

    mapCtx.restore();
  }

  // Atajos de teclado (B: plegar/desplegar mapa, N: plegar/desplegar daño, Alt+J: mejoras/build, H: modal historial, ESC: cierra modal historial, M: ocultar HUD)
  document.addEventListener('keydown', event => {
    if (event.repeat) return;

    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyJ') {
      if (activeRun && elMejorasBtn) {
        event.preventDefault();
        toggleBuffsSection();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key === 'Escape') {
      if (isEditingUI) {
        event.stopPropagation();
        closeUiEditor(true);
        return;
      }
      if (historyModal.classList.contains('open')) {
        event.stopPropagation();
        closeHistoryModal();
        return;
      }
    }

    const target = event.target;
    if (
      target &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'h') {
      if (historyModal.classList.contains('open')) {
        closeHistoryModal();
      } else {
        openHistoryModal();
      }
      return;
    }

    if (!activeRun) return;

    if (key === 'm') {
      hiddenByUser = !hiddenByUser;
      updateHudVisibility();
    } else if (key === 'b') {
      mapFoldBtn.click();
    } else if (key === 'n') {
      statsFoldBtn.click();
    } else if (event.key === '[') {
      radiusWorld = Math.min(MAX_MAP_RADIUS, Math.round(radiusWorld * 1.25));
      updateZoomUI();
    } else if (event.key === ']') {
      radiusWorld = Math.max(MIN_MAP_RADIUS, Math.round(radiusWorld / 1.25));
      updateZoomUI();
    } else if (event.key === 'End' || event.code === 'End' || event.key === 'Fin') {
      event.preventDefault();
      resetFovZoom();
    }
  }, true);

  // Control dinámico de FOV mediante Scroll de ratón (v3.5)
  window.addEventListener('wheel', event => {
    if (!activeRun) return;

    // No aplicar zoom de FOV si el usuario hace scroll dentro de los paneles HUD, modal de historial, barra de vida, bufos, editor o gacha
    if (
      event.target &&
      (event.target.closest('#psm-map-panel') ||
       event.target.closest('#psm-stats-panel') ||
       event.target.closest('#psm-history-modal') ||
       event.target.closest('#psm-custom-hp-bar') ||
       event.target.closest('#psm-custom-buffs-bar') ||
       event.target.closest('#psm-ui-editor-overlay') ||
       event.target.closest('#scr-gacha'))
    ) {
      return;
    }

    // No aplicar zoom de FOV si hay menús o pantallas modales abiertas (Pausa, Over, etc.)
    if (isAnyModalOrOverlayOpen()) return;

    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    setFovZoom(fovZoom * factor);
  }, { passive: false });

  // Bucle de estado y visibilidad automática del HUD
  setInterval(() => {
    ensureNativeHistoryButtons();
    ensureNativeGachaToggle();

    const overEl = document.getElementById('scr-over');
    if (overEl && isVisible(overEl) && !runSavedForCurrentSession && runStartedAt > 0) {
      captureAndSaveCurrentRun(true);
    }

    const next = detectGameplay();
    if (next !== activeRun) {
      if (!activeRun && next) {
        startNewRunSession();
        if (fovZoom !== 1.0) applyEngineFov();
      } else if (activeRun && !next) {
        captureAndSaveCurrentRun(Boolean(overEl && isVisible(overEl)));
      }
      activeRun = next;
      updateHudVisibility();
    }

    syncHudModalDimming();

    if (activeRun) {
      tickEngineClockAndXp();
      updateCustomHpBar();
      updateCustomBuffsBar();

      let bossesCount = 0;
      const NS = gameNS || window.__psmNS;
      if (NS && NS.EnemyMgr && typeof NS.EnemyMgr.all === 'function') {
        for (const e of (NS.EnemyMgr.all() || [])) {
          if (e && !e.dead && (e.boss || e.legend || e.judge)) {
            bossesCount++;
          }
        }
      } else {
        for (const ent of trackedEntities.values()) {
          if (ent.type === 'boss' && !isInsideKnownAllyBox(ent.x, ent.y)) {
            bossesCount++;
          }
        }
      }

      const dps = getCurrentDPS();
      statusLeft.textContent = `Zonas: ${chunks.size + allyExploredZones.size} · PDI: ${permanentProps.size} · Jefes: ${bossesCount}`;
      statusRight.textContent = dps > 0 ? `${formatNumber(dps)} DPS` : (maxDpsRecorded > 0 ? `Máx: ${formatNumber(maxDpsRecorded)}` : '');

      if (!hiddenByUser && !statsCollapsed) {
        renderStatsUI();
      }
    } else {
      detectCompanionFromMenu();
      if (isEditingUI) {
        updateCustomHpBar();
        updateCustomBuffsBar();
      }
    }
  }, 220);

  setInterval(() => {
    syncHudModalDimming();
    if (activeRun || isEditingUI) {
      updateCustomBuffsBar();
    }
    if (activeRun && !hiddenByUser && !mapCollapsed) {
      drawMap();
    }
  }, 80);

  updateHudVisibility();
  if (fovZoom !== 1.0) applyEngineFov();
  updateZoomUI();
  updateFovBadge();
  console.info('[PS Minimap] v3.9.3 (Minimapa Abajo Derecha + Panel Daño Arriba Izquierda + Editor UI Barra de Vida y Widget de Bufos) instalado.');
  }
})();