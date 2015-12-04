var EventEmitter = require("events").EventEmitter;
var semver = require("semver");

var AppDispatcher = require("../AppDispatcher");
var Util = require("../helpers/Util");
var InfoStore = require("../stores/InfoStore");
var InfoActions = require("../actions/InfoActions");
var InfoEvents = require("../events/InfoEvents");
var MesosActions = require("../actions/MesosActions");
var MesosEvents = require("../events/MesosEvents");

const FILES_TTL = 60000;
const STATE_TTL = 60000;
const REQUEST_DELAY = 100;
const MASTER_ID = "master";

var version = null;
var stateMap = {};
var taskFileMap = {};
var taskFileRequestQueue = [];
var requestCount = 0;

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

var MesosStore = Object.assign({

  getState: function (nodeId) {
    return getDataFromMap(nodeId, stateMap, STATE_TTL);
  },

  getTaskFiles: function (taskId) {
    return getDataFromMap(taskId, taskFileMap, FILES_TTL);
  }

}, EventEmitter.prototype);

function getNodeUrlFromState(nodeId, state) {

  if (state == null) {
    return null;
  }

  let agent = state.slaves.find((slave) => {
    return slave.id === nodeId;
  });

  if (agent == null) {
    return null;
  }

  let pid = agent.pid;
  let hostname = agent.hostname;
  return `//${hostname}:${pid.substring(pid.lastIndexOf(":") + 1)}`;
}

function getExecutorDirectoryFromState(frameworkId, taskId, state) {

  if (state == null) {
    return null;
  }

  function matchFramework(framework) {
    return frameworkId === framework.id;
  }

  let framework = state.frameworks.find(matchFramework) ||
    state.completed_frameworks.find(matchFramework);

  if (framework == null) {
    return null;
  }

  function matchExecutor(executor) {
    return taskId === executor.id;
  }

  let executor = framework.executors.find(matchExecutor) ||
    framework.completed_executors.find(matchExecutor);

  if (executor == null) {
    return null;
  }

  return executor.directory;
}

function throttleRequest(request) {
  setTimeout(request, Math.pow(++requestCount, 2)*REQUEST_DELAY);
}

function resolveTaskFileRequests() {
  var info = InfoStore.info;

  if (taskFileRequestQueue.length === 0) {
    return;
  }

  if (!Util.isString(info.frameworkId) ||
      !Util.isObject(info.marathon_config) ||
      !Util.isString(info.marathon_config.mesos_leader_ui_url)) {
    throttleRequest(()=>InfoActions.requestInfo());
    return;
  }

  if (!version) {
    throttleRequest(()=>MesosActions.requestVersionInformation(
      info.marathon_config.mesos_leader_ui_url.replace(/\/$/, "")));
    return;
  }

  if (!MesosStore.getState(MASTER_ID)) {
    throttleRequest(()=>{MesosActions.requestState(MASTER_ID,
      info.marathon_config.mesos_leader_ui_url.replace(/\/?$/, "/master"),
      version)});
    return;
  }

  taskFileRequestQueue.forEach((request, index) => {
    var taskId = request.taskId;
    var agentId = request.agentId;

    if (!MesosStore.getState(agentId)) {
      let masterState = MesosStore.getState(MASTER_ID);
      let nodeUrl = getNodeUrlFromState(agentId, masterState);
      if (nodeUrl == null) {
        invalidateMapData(MASTER_ID, stateMap);
        resolveTaskFileRequests();
        return;
      }

      MesosActions.requestState(agentId, nodeUrl, version);
      return;
    }

    if (!MesosStore.getTaskFiles(taskId)) {
      let masterState = MesosStore.getState(MASTER_ID);
      let agentState = MesosStore.getState(agentId);
      let nodeUrl = getNodeUrlFromState(agentId, masterState);
      let executorDirectory =
        getExecutorDirectoryFromState(info.frameworkId, taskId, agentState);

      if (nodeUrl == null || executorDirectory == null) {
        invalidateMapData(agentId, stateMap);
        resolveTaskFileRequests();
        return;
      }

      MesosActions.requestFiles(taskId, nodeUrl, executorDirectory, version);
      return;
    }

    // Everything is fine, we have the file, let's remove it from the queue
    taskFileRequestQueue.splice(index, 1);
  });

  requestCount = 0;
}

AppDispatcher.register(function (action) {
  var data = action.data;
  switch (action.actionType) {
    case MesosEvents.REQUEST_FILES:
      taskFileRequestQueue.push({
        agentId: data.agentId,
        taskId: data.taskId
      });
      requestCount = 0;
      resolveTaskFileRequests();
      break;
    case InfoEvents.REQUEST:
      AppDispatcher.waitFor([InfoStore.dispatchToken]);
      resolveTaskFileRequests();
      break;
    case MesosEvents.REQUEST_VERSION_INFORMATION_COMPLETE:
      version = data.version;
      resolveTaskFileRequests();
      break;
    case MesosEvents.REQUEST_VERSION_INFORMATION_ERROR:
      version = "0.0.0";
      resolveTaskFileRequests();
      break;
    case MesosEvents.REQUEST_STATE_COMPLETE:
      addDataToMap(data.id, stateMap, data.state);
      resolveTaskFileRequests();
      MesosStore.emit(MesosEvents.CHANGE);
      MesosStore.emit(MesosEvents.STATE_CHANGE);
      break;
    case MesosEvents.REQUEST_STATE_ERROR:
      resolveTaskFileRequests();
      MesosStore.emit(MesosEvents.REQUEST_STATE_ERROR, data.body);
      break;
    case MesosEvents.REQUEST_FILES_COMPLETE:
      let downloadRoute = "/files/download.json";
      if (semver.valid(version) && semver.satisfies(version,">=0.26.0")) {
        downloadRoute = "/files/download";
      }
      addDataToMap(data.id, taskFileMap, data.files.map(file => {
        var encodedPath = encodeURIComponent(file.path);
        file.host = data.host;
        file.name = /[^/]+\/?$/.exec(file.path)[0];
        file.downloadUri = `${data.host}${downloadRoute}?path=${encodedPath}`;
        return file;
      }));
      resolveTaskFileRequests();
      MesosStore.emit(MesosEvents.CHANGE);
      MesosStore.emit(MesosEvents.TASK_FILE_CHANGE);
      break;
    case MesosEvents.REQUEST_FILES_ERROR:
      MesosStore.emit(MesosEvents.REQUEST_FILES_ERROR, data.body);
      break;
  }
});

module.exports = MesosStore;

