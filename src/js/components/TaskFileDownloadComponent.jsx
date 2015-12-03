var React = require("react/addons");
var classNames = require("classnames");

var MesosActions = require("../actions/MesosActions");
var MesosEvents = require("../events/MesosEvents");
var MesosStore = require("../stores/MesosStore");

var TaskFileDownloadComponent = React.createClass({
  displayName: "TaskFileDownloadComponent",
  propTypes: {
    children: React.PropTypes.node,
    className: React.PropTypes.string,
    fileName: React.PropTypes.string.isRequired,
    task: React.PropTypes.object.isRequired
  },

  getInitialState: function () {
    return {
      file: this.getFile(),
      fileIsRequestedByUser: false
    };
  },

  componentWillMount: function () {
    MesosStore.on(MesosEvents.TASK_FILE_CHANGE, this.onMesosTaskFileChange);
  },

  componentWillUnmount: function () {
    MesosStore.removeListener(MesosEvents.TASK_FILE_CHANGE,
      this.onMesosTaskFileChange);
  },

  getFile: function () {
    var props = this.props;
    var task = this.props.task;
    var taskId = task.id || task.taskId;
    var files = MesosStore.getTaskFiles(taskId);
    if (files != null && files.length) {
      return files.filter(file => file.name === props.fileName)[0];
    }
    return null;
  },

  onMesosTaskFileChange: function () {
    var file = this.getFile();
    var fileIsRequestedByUser = this.state.fileIsRequestedByUser;
    // Start download if file was requested by the user
    if (file != null && fileIsRequestedByUser) {
      window.open(file.download);
      fileIsRequestedByUser = false;
    }
    this.setState({
      file: file,
      fileIsRequestedByUser: fileIsRequestedByUser
    });
  },

  handleClick: function (event) {
    var file = this.state.file;
    if (file == null) {
      event.preventDefault();
      let task = this.props.task;
      let agentId = task.slaveId;
      let taskId = task.id || task.taskId;
      MesosActions.requestTaskFiles(agentId, taskId);
      this.setState({
        fileIsRequestedByUser: true
      });
    }
  },

  render: function () {
    var className = classNames("task-file-download", this.props.className, {
      "loading": this.state.requested
    });
    var file = this.state.file;
    var href = "";
    var name = "";
    if (file) {
      name = file.name;
      href = file.download;
    }
    return (
      <a className={className}
          href={href}
          onClick={this.handleClick}
          ref="download"
          download={name}>
        {this.props.children}
      </a>
    );
  }
});

module.exports = TaskFileDownloadComponent;
