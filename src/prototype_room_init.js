'use strict';

Room.prototype.initSetController = function() {
  if (this.controller) {
    let costMatrix = this.getMemoryCostMatrix();
    let upgraderPos = this.controller.pos.findNearPosition().next().value;
    this.memory.position.creep[this.controller.id] = upgraderPos;
    costMatrix.set(upgraderPos.x, upgraderPos.y, config.layout.creepAvoid);
    this.setMemoryCostMatrix(costMatrix);
  }
};

Room.prototype.initSetSources = function() {
  let sources = this.find(FIND_SOURCES);
  let costMatrix = this.getMemoryCostMatrix();
  for (let source of sources) {
    let sourcer = source.pos.findNearPosition().next().value;
    this.memory.position.creep[source.id] = sourcer;
    // TODO E.g. E11S8 it happens that sourcer has no position
    if (sourcer) {
      let link = sourcer.findNearPosition().next().value;
      this.memory.position.structure.link.push(link);
      costMatrix.set(link.x, link.y, config.layout.structureAvoid);
      this.setMemoryCostMatrix(costMatrix);
    }
  }
};

Room.prototype.initSetMinerals = function() {
  let costMatrix = this.getMemoryCostMatrix();
  let minerals = this.find(FIND_MINERALS);
  for (let mineral of minerals) {
    let extractor = mineral.pos.findNearPosition().next().value;
    this.memory.position.creep[mineral.id] = extractor;
    this.memory.position.structure.extractor.push(mineral.pos);
    costMatrix.set(extractor.x, extractor.y, config.layout.creepAvoid);
    this.setMemoryCostMatrix(costMatrix);
  }
};

Room.prototype.initSetStorageAndPathStart = function() {
  let costMatrix = this.getMemoryCostMatrix();
  let storagePos = this.memory.position.creep[this.controller.id].findNearPosition().next().value;
  this.memory.position.structure.storage.push(storagePos);
  // TODO should also be done for the other structures
  costMatrix.set(storagePos.x, storagePos.y, config.layout.structureAvoid);
  this.setMemoryCostMatrix(costMatrix);

  this.memory.position.creep.pathStart = storagePos.findNearPosition().next().value;

  let route = [{
    room: this.name
  }];
  let pathUpgrader = this.getPath(route, 0, 'pathStart', this.controller.id, true);
  // TODO exclude the last position (creepAvoid) in all paths
  for (let pos of pathUpgrader) {
    if (this.memory.position.creep[this.controller.id].isEqualTo(pos.x, pos.y)) {
      continue;
    }
    costMatrix.set(pos.x, pos.y, config.layout.pathAvoid);
  }
  this.setMemoryCostMatrix(costMatrix);
  return {
    storagePos: storagePos,
    route: route
  };
};

Room.prototype.updatePosition = function() {
  this.log('Update position');
  cache.rooms[this.name] = {};
  delete this.memory.routing;

  let costMatrixBase = this.getCostMatrix();
  this.setMemoryCostMatrix(costMatrixBase);
  this.memory.position = {
    creep: {}
  };
  this.memory.position.structure = {
    storage: [],
    spawn: [],
    extension: [],
    tower: [],
    link: [],
    observer: [],
    lab: [],
    terminal: [],
    nuker: [],
    powerSpawn: [],
    extractor: []
  };

  this.initSetController();
  this.initSetSources();
  this.initSetMinerals();

  if (this.controller && this.controller.my) {
    let startPos = this.initSetStorageAndPathStart();

    let sources = this.find(FIND_SOURCES);
    for (let source of sources) {
      let route = [{
        room: this.name
      }];
      let path = this.getPath(route, 0, 'pathStart', source.id, true);
      for (let pos of path) {
        let posObject = new RoomPosition(pos.x, pos.y, this.name);
        let sourcer = this.memory.position.creep[source.id];
        if (posObject.isEqualTo(sourcer.x, sourcer.y)) {
          continue;
        }

        costMatrixBase.set(pos.x, pos.y, config.layout.pathAvoid);
      }
      let sourcer = this.memory.position.creep[source.id];
      costMatrixBase.set(sourcer.x, sourcer.y, config.layout.creepAvoid);
      this.setMemoryCostMatrix(costMatrixBase);
    }

    this.setFillerArea(startPos.storagePos, costMatrixBase, startPos.route);
  }

  this.setMemoryCostMatrix(costMatrixBase);
  return costMatrixBase;
};

Room.prototype.setTowerFiller = function() {
  let exits = _.map(Game.map.describeExits(this.name));
  this.memory.position.creep.towerfiller = [];

  for (let index = 0; index < CONTROLLER_STRUCTURES.tower[8] - 1; index++) {
    let roomName = exits[index % exits.length];
    if (!roomName) {
      break;
    }
    for (let offsetDirection = 2; offsetDirection < 7; offsetDirection += 4) {
      let linkSet = false;
      let towerFillerSet = false;
      let positionsFound = false;
      let path = this.getMemoryPath('pathStart' + '-' + roomName);
      for (let pathIndex = path.length - 1; pathIndex >= 1; pathIndex--) {
        let posPath = path[pathIndex];
        let posPathObject = new RoomPosition(posPath.x, posPath.y, posPath.roomName);
        let posPathNext = path[pathIndex - 1];

        let directionNext = posPathObject.getDirectionTo(posPathNext.x, posPathNext.y, posPathNext.roomName);

        let offset = (directionNext + offsetDirection - 1) % 8 + 1;
        let pos = posPathObject.buildRoomPosition(offset);
        if (pos.x <= 4 || pos.x >= 45 || pos.y <= 4 || pos.y >= 45) {
          continue;
        }

        if (pos.inPositions()) {
          continue;
        }

        if (pos.inPath()) {
          continue;
        }

        let terrain = pos.lookFor(LOOK_TERRAIN)[0];
        if (terrain === 'wall') {
          break;
        }

        if (!linkSet) {
          this.memory.position.structure.link.push(pos);
          linkSet = true;
          continue;
        }
        if (!towerFillerSet) {
          this.memory.position.creep.towerfiller.push(pos);
          towerFillerSet = true;
          continue;
        }
        this.memory.position.structure.tower.push(pos);
        positionsFound = true;
        break;
      }

      if (positionsFound) {
        break;
      }
    }
  }
};

function setLabsTerminal(room, path, costMatrixBase) {
  for (let pathI = path.length - 1; pathI > 0; pathI--) {
    let pathPos = new RoomPosition(path[pathI].x, path[pathI].y, room.name);
    let structurePosIterator = pathPos.findNearPosition();
    for (let structurePos of structurePosIterator) {
      if (room.memory.position.structure.lab.length < CONTROLLER_STRUCTURES.lab[8]) {
        room.memory.position.structure.lab.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }
      if (room.memory.position.structure.terminal.length < CONTROLLER_STRUCTURES.terminal[8]) {
        room.memory.position.structure.terminal.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        room.memory.position.pathEnd = [pathPos];
        continue;
      }
      if (room.memory.position.structure.lab.length < CONTROLLER_STRUCTURES.lab[8] ||
        room.memory.position.structure.terminal.length < CONTROLLER_STRUCTURES.terminal[8]) {
        room.log('Structures not found: ' +
          'lab: ' + room.memory.position.structure.lab.length + ' ' +
          'terminal: ' + room.memory.position.structure.terminal.length
        );
        continue;
      }
      if (!room.memory.position.pathEnd) {
        room.log('Room not completly build');
      }
      console.log('All labs/terminal set: ' + pathI);
      return pathI;
    }
  }
  room.setMemoryCostMatrix(costMatrixBase);

  return -1;
}

function setStructures(room, path, costMatrixBase) {
  room.setTowerFiller();

  let pathI;
  for (pathI in path) {
    let pathPos = new RoomPosition(path[pathI].x, path[pathI].y, room.name);
    let structurePosIterator = pathPos.findNearPosition();
    for (let structurePos of structurePosIterator) {
      if (structurePos.setSpawn(pathPos, path[+pathI + 1])) {
        room.memory.position.structure.spawn.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }
      if (structurePos.setExtension()) {
        room.memory.position.structure.extension.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        if (!room.memory.position.pathEndLevel) {
          room.memory.position.pathEndLevel = [0];
        }
        if (CONTROLLER_STRUCTURES.extension[room.memory.position.pathEndLevel.length] <= room.memory.position.structure.extension.length) {
          room.memory.position.pathEndLevel.push(pathI);
        }
        continue;
      }
      if (room.memory.position.structure.spawn.length < CONTROLLER_STRUCTURES.spawn[8] && room.memory.position.structure.extension.length < CONTROLLER_STRUCTURES.extension[8]) {
        continue;
      }

      // TODO Build labs, terminal, nuker ... at the path to extractor / mineral or the next path which diverge from the harvester path
      if (room.memory.position.structure.tower.length < CONTROLLER_STRUCTURES.tower[8]) {
        room.memory.position.structure.tower.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }
      if (room.memory.position.structure.nuker.length < CONTROLLER_STRUCTURES.nuker[8]) {
        room.memory.position.structure.nuker.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }
      if (room.memory.position.structure.observer.length < CONTROLLER_STRUCTURES.observer[8]) {
        room.memory.position.structure.observer.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }

      if (room.memory.position.structure.link.length < CONTROLLER_STRUCTURES.link[8]) {
        room.memory.position.structure.link.push(structurePos);
        costMatrixBase.set(structurePos.x, structurePos.y, config.layout.structureAvoid);
        continue;
      }

      if (room.memory.position.structure.spawn.length < CONTROLLER_STRUCTURES.spawn[8] ||
        room.memory.position.structure.extension.length < CONTROLLER_STRUCTURES.extension[8] ||
        room.memory.position.structure.tower.length < CONTROLLER_STRUCTURES.tower[8] ||
        room.memory.position.structure.link.length < CONTROLLER_STRUCTURES.link[8] ||
        room.memory.position.structure.observer.length < CONTROLLER_STRUCTURES.observer[8] ||
        room.memory.position.structure.nuker.length < CONTROLLER_STRUCTURES.nuker[8]) {
        room.log('Structures not found: ' +
          'spawns: ' + room.memory.position.structure.spawn.length + ' ' +
          'extensions: ' + room.memory.position.structure.extension.length + ' ' +
          'towers: ' + room.memory.position.structure.tower.length + ' ' +
          'links: ' + room.memory.position.structure.link.length + ' ' +
          'observer: ' + room.memory.position.structure.observer.length + ' ' +
          'lab: ' + room.memory.position.structure.lab.length + ' ' +
          'terminal: ' + room.memory.position.structure.terminal.length + ' ' +
          'nuker: ' + room.memory.position.structure.nuker.length
        );
        continue;
      }
      if (!room.memory.position.pathEnd) {
        room.log('Room not completly build');
      }
      //      let pathIndex = _.findIndex(path, i => i.x === room.memory.position.pathEnd[0].x && i.y === room.memory.position.pathEnd[0].y);
      //      room.memory.position.path = path.slice(0, pathIndex);
      //      return positions;
      console.log('All structures set: ' + pathI);
      return pathI;
    }
  }
  room.setMemoryCostMatrix(costMatrixBase);

  return -1;
}

Room.prototype.buildCostMatrix = function() {
  this.deleteMemoryPaths();
  this.memory.costMatrix = {};

  // TODO adapt updatePosition => init Position and set the costmatrix
  this.log('buildCostMatrix');
  let costMatrixBase = this.updatePosition();

  let exits = Game.map.describeExits(this.name);
  if (this.controller) {
    // TODO which first minerals or sources? Maybe order by length of path
    let minerals = this.find(FIND_MINERALS);
    for (let mineral of minerals) {
      let route = [{
        room: this.name
      }];
      let path = this.getPath(route, 0, 'pathStart', mineral.id, true);
      for (let pos of path) {
        costMatrixBase.set(pos.x, pos.y, config.layout.pathAvoid);
      }
      this.setMemoryCostMatrix(costMatrixBase);
    }

    for (let endDir in exits) {
      let end = exits[endDir];
      let route = [{
        room: this.name
      }, {
        room: end
      }];
      let path = this.getPath(route, 0, 'pathStart', undefined, true);
      for (let pos of path) {
        costMatrixBase.set(pos.x, pos.y, config.layout.pathAvoid);
      }
      this.setMemoryCostMatrix(costMatrixBase);
    }
    return costMatrixBase;
  }

  for (let startDir in exits) {
    let start = exits[startDir];
    for (let endDir in exits) {
      let end = exits[endDir];
      if (start === end) {
        continue;
      }
      let route = [{
        room: start
      }, {
        room: this.name
      }, {
        room: end
      }];
      let path = this.getPath(route, 1, undefined, undefined, true);
      for (let pos of path) {
        costMatrixBase.set(pos.x, pos.y, config.layout.pathAvoid);
      }
      this.setMemoryCostMatrix(costMatrixBase);
    }
  }
  return costMatrixBase;
};

Room.prototype.setup = function() {
  delete this.memory.constants;
  this.log('costmatrix.setup called');
  this.memory.controllerLevel = {};

  let costMatrixBase = this.buildCostMatrix();
  //  this.memory.position = {
  //    creep: {}
  //  };

  // TODO find longest path, calculate vert-/horizontal as 2 (new structures) and diagonal as 4

  let sorter = function(object) {
    let last_pos;
    let value = 0;
    for (let pos of object.path) {
      let valueAdd = 0;
      if (!last_pos) {
        last_pos = new RoomPosition(pos.x, pos.y, pos.roomName);
        continue;
      }
      let direction = last_pos.getDirectionTo(pos.x, pos.y, pos.roomName);
      if (direction % 2 === 0) {
        valueAdd += 2;
      } else {
        valueAdd += 4;
      }

      for (let x = -1; x < 2; x++) {
        for (let y = -1; y < 2; y++) {
          let wall = new RoomPosition(pos.x + x, pos.y + y, pos.roomName);
          let terrains = wall.lookFor(LOOK_TERRAIN);
          if (terrains === 'wall') {
            valueAdd *= 0.5; // TODO some factor
          }
        }
      }
      value += valueAdd;
      last_pos = new RoomPosition(pos.x, pos.y, pos.roomName);
    }
    return value;
  };

  let paths_controller = _.filter(this.getMemoryPaths(), function(object, key) {
    return key.startsWith('pathStart-');
  });
  let paths_sorted = _.sortBy(paths_controller, sorter);
  let path = this.getMemoryPath(paths_sorted[paths_sorted.length - 1].name);
  let pathLB = this.getMemoryPath(paths_controller[4].name);
  let pathL = setLabsTerminal(this, pathLB, costMatrixBase);
  let pathI = setStructures(this, path, costMatrixBase);
  console.log('path: ' + path.name + ' pathI: ' + pathI + ' length: ' + path.length);
  if (pathI === -1) {
    pathI = path.length - 1;
  }

  this.setMemoryPath('pathStart-harvester', path.slice(0, pathI + 1), true);
  this.memory.position.version = config.layout.version;

  for (let structureId in this.memory.position.structure) {
    let structures = this.memory.position.structure[structureId];
    for (let pos of structures) {
      costMatrixBase.set(pos.x, pos.y, config.layout.structureAvoid);
    }
  }
  this.setMemoryCostMatrix(costMatrixBase);
};
