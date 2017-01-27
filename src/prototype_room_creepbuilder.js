'use strict';
Room.prototype.spawnCheckForCreate = function() {
  let storages;
  let energyNeeded;
  let unit;

  if (this.memory.queue.length > 0) {
    let room = this;

    let priorityQueue = function(object) {
      let priority = config.priorityQueue;

      let ret = 0;
      let target = object.routing && object.routing.targetRoom;

      if (target === room.name) {
        ret = priority.sameRoom[object.role] || 4;

      } else if (target) {
        ret = priority.otherRoom[object.role];

      } else { ret = 12; }

      if (ret) { return ret; }

      // TODO added because target was misused as a pos object

      return 100 + Game.map.getRoomLinearDistance(room.name, target);
    };

    this.memory.queue = _.sortBy(this.memory.queue, priorityQueue);

    let creep = this.memory.queue[0];
    energyNeeded = 50;

    if (this.spawnCreateCreep(creep)) {
      this.memory.queue.shift();
    } else {
      if (creep.ttl === 0) {
        this.log('TTL reached, skipping: ' + JSON.stringify(creep));
        this.memory.queue.shift();
        return;
      }

      // TODO maybe skip only if there is a spawn which is not spawning
      creep.ttl = creep.ttl || config.creep.queueTtl;
      let spawnsNotSpawning = _.filter(this.find(FIND_MY_SPAWNS), function(object) {
        return !object.spawning;
      });
      if (spawnsNotSpawning.length === 0) {
        creep.ttl--;
      }
    }
    // Spawing only one per tick
    return;
  }

  return false;
};

Room.prototype.checkRoleToSpawn = function(role, amount, targetId, targetRoom, level, base) {
  if (targetRoom === undefined) {
    targetRoom = this.name;
  }
  if (amount === undefined) {
    amount = 1;
  }

  let creepMemory = {
    role: role,
    level: level,
    base: base || undefined,
    routing: {
      targetRoom: targetRoom,
      targetId: targetId
    }
  };

  if (this.inQueue(creepMemory)) {
    return false;
  }

  if (targetRoom === this.name) {
    let creeps = this.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        if (creep.memory.routing === undefined) {
          return false;
        }
        if (targetId !== undefined &&
          targetId !== creep.memory.routing.targetId) {
          return false;
        }
        if (targetRoom !== undefined &&
          targetRoom !== creep.memory.routing.targetRoom) {
          return false;
        }
        return creep.memory.role === role;
      }
    });
    if (creeps.length >= amount) {
      return false;
    }
  }

  let spawns = this.find(FIND_MY_STRUCTURES, {
    filter: function(object) {
      return object.structureType === STRUCTURE_SPAWN;
    }
  });

  for (var spawn of spawns) {
    if (!spawn.spawning || spawn.spawning === null) {
      continue;
    }

    let creep = Game.creeps[spawn.spawning.name];
    if (creep.memory.role === role) {
      return false;
    }
    if (targetId && creep.memory.routing) {
      if (targetId !== creep.memory.routing.targetId) {
        return false;
      }
    }
    if (creep.memory.routing) {
      if (targetRoom !== creep.memory.routing.targetRoom) {
        return false;
      }
    }
  }
  this.memory.queue.push(creepMemory);
};

/**
 * Room.prototype.checkParts use for check if a bodyPart can be add to total body and return cost or 0 if there is not enouth energy.
 *
 * @param {Array} parts Array of body parts.
 * @param {Number} energyAvailable energy allow for spawn.
 */

Room.prototype.getCostForParts = function(parts, energyAvailable) {
  if (!parts) { return 0; }
  let cost = 0;
  let fail = false;
  parts.forEach(
    (p) => {
      cost += BODYPART_COST[p];
      if (cost > energyAvailable) {
        fail = true;
      }
    }
  );
  return fail ? 0 : cost;
};

/**
 * Room.prototype.getSettings use for return creep spawn settings
 * adapted to room configuration
 *
 * @param {Collection} creep queue's creep spawn basic datas
 */
Room.prototype.getSettings = function(creep) {
  let role = creep.role;
  let levelModif = roles[role].checkLevel && roles[role].checkLevel(this, creep);
  let settings = _.merge(roles[role].settings, levelModif);
  if (!settings) {
    this.log('try to spawn ', role, ' but settings are not done. Abort spawn');
    return;
  }
  let param = settings.param;
  return _.mapValues(settings, (setting, settingName) => {
    if (!param) {
      return setting;
    }
    for (let parameter of param) {
      if (_.isString(setting) || _.isNumber(setting) || _.isArray(setting)) {
        break;
      }
      let valueForI = _.get(this, parameter, 1);
      let foundKey = 0;
      for (let key of Object.keys(setting)) {
        if (valueForI < key && foundKey !== 0) {
          break;
        }
        foundKey = key;
      }
      setting = setting[foundKey];
    }
    return setting;
  });
};

Room.prototype.applyAmount = function(array, amount) {

  let cost = 0;
  let parts = [];
  _.forEach(amount, function(element, index) {
    for (let i = 0; i < element; i++) {
      parts.push(array[index]);
    }
  });

  return parts;
};

/**
 * Room.prototype.getPartsConfig use for generate adapted body
 *
 * @param {Collection} creep queue's creep spawn basic datas
 */

Room.prototype.getPartConfig = function(creep) {
  let parts = [];
  let energyAvailable = this.energyAvailable;
  let datas = this.getSettings(creep);
  if (!datas) { return; }

  let {
    prefixParts,
    layout,
    amount,
    maxLayoutAmount,
    sufixParts
  } = datas;

  let maxBodyLength = MAX_CREEP_SIZE;
  if (prefixParts) { maxBodyLength -= prefixParts.length; }
  if (sufixParts) { maxBodyLength -= sufixParts.length; }

  prefixParts = global.utils.stringToParts(prefixParts);
  let prefixCost = this.getCostForParts(prefixParts, energyAvailable);
  energyAvailable -= prefixCost;
  layout = global.utils.stringToParts(layout);
  if (amount) {
    layout = this.applyAmount(layout, amount); // [M, W, R] , [1, 2, 3] -----> [M, W, W, R, R, R]
  }
  let layoutCost = this.getCostForParts(layout, energyAvailable);
  //console.log(JSON.stringify(prefixCost, '-', layoutCost));
  if (layoutCost) {

    parts = prefixParts || [];
    let maxRepeat = Math.floor(Math.min(energyAvailable / layoutCost, maxBodyLength / layout.length));
    if (!maxRepeat) {
      return;
    }
    if (maxLayoutAmount) {
      maxRepeat = Math.min(maxLayoutAmount, maxRepeat);
    }
    parts = parts.concat(_.flatten(Array(maxRepeat).fill(layout)));
    energyAvailable -= layoutCost * maxRepeat;
  } else {
    return;
  }

  sufixParts = global.utils.stringToParts(sufixParts);
  let sufixCost = this.getCostForParts(sufixParts, energyAvailable);
  if (sufixCost) {
    parts = parts.concat(sufixParts);
    energyAvailable -= sufixCost;
  }
  let sort = function(parts) {
    return _.sortBy(parts, function(p) {
      let order = _.indexOf(layout, p) + 1;
      if (order) {
        return order;
      } else {
        return layout.length;
      }
    });
  };
  return config.creep.sortParts ? sort(parts) : parts;
};

/**
 * Room.prototype.spawnCreateCreep use for launch spawn of first creep in queue.
 *
 * @param {Collection} creep Object with queue's creep datas.
 */
Room.prototype.spawnCreateCreep = function(creep) {
  var spawns = this.find(FIND_MY_SPAWNS);
  spawns.forEach(s => {
    if (s.spawning) {
      spawns.shift();
    }
  });
  if (spawns.length === 0) { return; }
  let role = creep.role;
  var energy = this.energyAvailable;

  let unit = roles[role];
  if (!unit) {
    this.log('Can not find role: ' + role + ' creep_' + role);
    return true;
  }

  var id = Math.floor((Math.random() * 1000) + 1);
  var name = role + '-' + id;
  //console.log(this.name,'--->',role);
  var partConfig = this.getPartConfig(creep);
  if (!partConfig) {
    return;
  }
  partConfig = partConfig.slice(0, MAX_CREEP_SIZE);

  for (let spawnName in spawns) {
    let spawn = spawns[spawnName];
    let memory = {
      role: role,
      number: id,
      step: 0,
      base: creep.base || this.name,
      born: Game.time,
      heal: creep.heal,
      level: creep.level,
      squad: creep.squad,
      // Values from the creep configuration
      killPrevious: unit.killPrevious,
      flee: unit.flee,
      buildRoad: unit.buildRoad,
      routing: creep.routing
    };
    let returnCode = spawn.createCreep(partConfig, name, memory);

    if (returnCode != name) {
      continue;
    }
    if (config.stats.enabled) {
      let userName = Memory.username || _.find(Game.spawns, 'owner').owner;
      Memory.stats = Memory.stats || {};
      Memory.stats[userName].roles = Memory.stats[userName].roles || {};
      let roleStat = Memory.stats[userName].roles[role];
      let previousAmount = roleStat ? roleStat : 0;
      Memory.stats[userName].roles[role] = previousAmount + 1;
    }
    return true;
  }
  return false;

};

Room.prototype.checkAndSpawnSourcer = function() {
  var sources = this.find(FIND_SOURCES);

  let source;

  let isSourcer = function(object) {
    if (object.memory.role !== 'sourcer') {
      return false;
    }
    if (object.memory.routing && object.memory.routing.targetId !== source.id) {
      return false;
    }
    if (object.memory.routing && object.memory.routing.targetRoom !== source.pos.roomName) {
      return false;
    }
    return true;
  };

  for (source of sources) {
    let sourcers = this.find(FIND_MY_CREEPS, {
      filter: isSourcer
    });
    if (sourcers.length === 0) {
      //      this.log(source.id);
      this.checkRoleToSpawn('sourcer', 1, source.id, this.name);
    }
  }
};
