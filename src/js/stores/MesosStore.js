var EventEmitter = require("events").EventEmitter;

var AppDispatcher = require("../AppDispatcher");
var Util = require("../helpers/Util");
var InfoStore = require("../stores/InfoStore");
var InfoActions = require("../actions/InfoActions");
var InfoEvents = require("../events/InfoEvents");
var MesosActions = require("../actions/MesosActions");
var MesosEvents = require("../events/MesosEvents");

const FILES_TTL = 60000;
const STATE_TTL = 60000;
const MASTER_ID = "master";

var stateMap = {};
var taskFileMap = {};
var taskFileRequestQueue = [];

var MesosStore = Object.assign({

  getState: function (nodeId) {
    return getDataFromMap(nodeId, stateMap, STATE_TTL);
  },

  getTaskFiles: function (taskId) {
    return getDataFromMap(taskId, taskFileMap, FILES_TTL);
  }

}, EventEmitter.prototype);

function getDataFromMap(id, map, ttl = 100) {
  if (!Util.isString(id) || map == null) {
    return null;
  }

  let item = map[id];
  if (item == null) {
    return null;
  }
  if (item.timestamp + ttl < Date.now()) {
    invalidateMapData(id, map);
    return null;
  }

  return item.data;
}

function invalidateMapData(id, map) {
  if (!Util.isString(id) || map == null) {
    return;
  }
  delete map[id];
}

function addDataToMap(id, map, data) {
  if (!Util.isString(id) || map == null || data == null) {
    return;
  }
  map[id] = {
    data: data,
    timestamp: Date.now()
  };
}

function getNodeUrl(nodeId) {
  var master = MesosStore.getState(MASTER_ID);
  if (master == null) {
    throw new Error(
      `Unable to get the node url as the master state is undefined.`
    );
  }

  let agent = master.slaves.find((slave) => {
    return slave.id === nodeId;
  });

  if (agent == null) {
    throw new Error(
      `Can't get the node url as the he node (${nodeId}) is undefined.`
    );
  }

  let pid = agent.pid;
  let hostname = agent.hostname;
  return `//${hostname}:${pid.substring(pid.lastIndexOf(":") + 1)}`;
}

function getExecutorDirectory(agentId, frameworkId, taskId) {
  var agentState = MesosStore.getState(agentId);

  if (agentState == null) {
    throw new Error(
      `Unable get the executor directory as the agent (${agentId})
      state is undefined.`
    );
  }

  function matchFramework(framework) {
    return frameworkId === framework.id;
  }

  let framework = agentState.frameworks.find(matchFramework) ||
    agentState.completed_frameworks.find(matchFramework);

  if (!framework) {
    throw new Error(
      `Can't get the executor directory as the Framework (${frameworkId})
       does not exist on the given agent (${agentId}).`
    );
  }

  function matchExecutor(executor) {
    return taskId === executor.id;
  }

  let executor = framework.executors.find(matchExecutor) ||
    framework.completed_executors.find(matchExecutor);

  if (executor == null) {
    throw new Error(
      `Unable to get the executor directory as the task (${taskId})
      does not exists.`
    );
  }

  return executor.directory;
}

function resolveTaskFileRequests() {
  var info = InfoStore.info;

  if (!info.hasOwnProperty("marathon_config")) {
    InfoActions.requestInfo();
    return;
  }

  if (!MesosStore.getState(MASTER_ID)) {
    MesosActions.requestState(MASTER_ID,
      info.marathon_config.mesos_leader_ui_url.replace(/\/?$/, "/master"));
    return;
  }

  taskFileRequestQueue.forEach((request, index) => {
    var taskId = request.taskId;
    var agentId = request.agentId;

    if (!MesosStore.getState(agentId)) {
      try {
        MesosActions.requestState(agentId, getNodeUrl(agentId));
      } catch (error) {
        invalidateMapData(MASTER_ID, stateMap);
        resolveTaskFileRequests();
      }
      return;
    }

    if (!MesosStore.getTaskFiles(taskId)) {
      try {
        MesosActions.requestFiles(taskId,
          getNodeUrl(agentId),
          getExecutorDirectory(agentId, info.frameworkId, taskId));
      } catch (error) {
        invalidateMapData(agentId, stateMap);
        resolveTaskFileRequests();
      }
      return;
    }

    // Everything is fine, we have the file, let's remove it from the queue
    taskFileRequestQueue.splice(index, 1);
  });
}

AppDispatcher.register(function (action) {
  var data = action.data;
  switch (action.actionType) {
    case MesosEvents.REQUEST_FILES:
      taskFileRequestQueue.push({
        agentId: data.agentId,
        taskId: data.taskId
      });
      resolveTaskFileRequests();
      break;
    case InfoEvents.CHANGE:
      resolveTaskFileRequests();
      break;
    case MesosEvents.REQUEST_STATE_COMPLETE:
      addDataToMap(data.id, stateMap, data.state);
      resolveTaskFileRequests();
      MesosStore.emit(MesosEvents.CHANGE);
      break;
    case MesosEvents.REQUEST_STATE_ERROR:
      MesosStore.emit(MesosEvents.REQUEST_STATE_ERROR, data.body);
      break;
    case MesosEvents.REQUEST_FILES_COMPLETE:
      addDataToMap(data.id, taskFileMap, data.files.map(file => {
        var encodedPath = encodeURIComponent(file.path);
        file.host = data.host;
        file.name = /[^/]+\/?$/.exec(file.path)[0];
        file.download = `${data.host}/files/download?path=${encodedPath}`;
        return file;
      }));
      resolveTaskFileRequests();
      MesosStore.emit(MesosEvents.CHANGE);
      break;
    case MesosEvents.REQUEST_FILES_ERROR:
      MesosStore.emit(MesosEvents.REQUEST_FILES_ERROR, data.body);
      break;
  }
});

module.exports = MesosStore;

