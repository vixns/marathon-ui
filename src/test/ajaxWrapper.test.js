var expect = require("chai").expect;
var ajaxWrapper = require("../js/helpers/ajaxWrapper");
var config = require("../js/config/config");

var expectAsync = require("./helpers/expectAsync");
var HttpServer = require("./helpers/HttpServer").HttpServer;

var server = new HttpServer(config.localTestserverURI);
config.apiURL = "http://" + server.address + ":" + server.port + "/";

describe("ajaxWrapper", function () {

  beforeEach(function (done) {
    this.server = server
      .setup({
        "name": "Marathon"
      }, 200)
      .start(done);
  });

  afterEach(function (done) {
    this.server.stop(done);
  });

  describe("on GET request", function () {

    it("returns a JSON object on success", function (done) {
      ajaxWrapper({
        method: "GET",
        url: config.apiURL
      })
      .success(function (response) {
        expectAsync(function () {
          expect(response.body.name).to.equal("Marathon");
        }, done);
      })
      .error(function () {
        done(new Error("I should not be called"));
      });
    });

    it("defaults to GET when no method is supplied", function (done) {
      ajaxWrapper({
        url: config.apiURL
      })
      .success(function (response) {
        expectAsync(function () {
          expect(response.body.name).to.equal("Marathon");
        }, done);
      })
      .error(function () {
        done(new Error("I should not be called"));
      });
    });

    it("handles failure gracefully", function (done) {
      this.server.setup({message: "Guru Meditation"}, 404);

      ajaxWrapper({
        method: "GET",
        url: config.apiURL + "/foo/bar"
      })
      .success(function () {
        done(new Error("I should not be called"));
      })
      .error(function (error) {
        expectAsync(function () {
          expect(error.body.message).to.equal("Guru Meditation");
        }, done);
      });
    });

  });

  describe("on concurrent request", function () {

    it("should timeout on second request", function (done) {
      var responses = 0;
      var timeoutId;
      var initialTimeout = this.timeout();
      this.timeout(50);

      var increaseResponses = function () {
        responses++;
        if (responses === 2) {
          clearTimeout(timeoutId);
          done(new Error("Second request should never be fulfilled"));
        }
      };

      ajaxWrapper({
        method: "GET",
        url: config.apiURL + "/concurrent"
      })
      .success(increaseResponses);

      ajaxWrapper({
        method: "GET",
        url: config.apiURL + "/concurrent"
      })
      .success(increaseResponses);

      timeoutId = setTimeout(() => {
        this.timeout(initialTimeout);
        done();
      }, 25);
    });

    it("should not timeout with flag set", function (done) {
      var responses = 0;

      function increaseResponses() {
        responses++;
        if (responses === 2) {
          done();
        }
      }

      ajaxWrapper({
        method: "GET",
        url: config.apiURL + "/concurrent",
        concurrent: true
      })
      .success(increaseResponses);

      ajaxWrapper({
        method: "GET",
        url: config.apiURL + "/concurrent",
        concurrent: true
      })
      .success(increaseResponses);
    });

  });

  describe("on POST request", function () {

    beforeEach(function () {
      this.server.setup(null, 200, true);
    });

    it("sends the correct payload", function (done) {
      var payload = {"key": "value"};

      ajaxWrapper({
        method: "POST",
        url: config.apiURL,
        data: payload
      })
        .success(function (response) {
          expectAsync(function (done) {
            expect(response.body.method).to.equal("POST");
            expect(response.body.payload).to.equal(JSON.stringify(payload));
          }, done);
        })
        .error(function () {
          done(new Error("I should not be called"));
        });
    });

    it("handles failure gracefully", function (done) {
      var payload = {"key": "value"};

      this.server.setup({message: "Guru Meditation"}, 404);

      ajaxWrapper({
        method: "POST",
        url: config.apiURL + "/foo/bar",
        data: payload
      })
        .success(function () {
          done(new Error("I should not be called"));
        })
        .error(function (error) {
          expectAsync(function () {
            expect(error.body.message).to.equal("Guru Meditation");
          }, done);
        });
    });

  });

  describe("on PUT request", function () {

    beforeEach(function () {
      this.server.setup(null, 200, true);
    });

    it("sends the correct payload with a PUT", function (done) {

      var payload = {"key": "value"};

      ajaxWrapper({
        method: "PUT",
        url: config.apiURL,
        data: payload
      })
        .success(response => {
          expectAsync(() => {
            expect(response.body.method).to.equal("PUT");
            expect(response.body.payload).to.equal(JSON.stringify(payload));
          }, done);
        })
        .error(() => {
          done(new Error("I should not be called"));
        });
    });

  });

  describe("on DELETE request", function () {

    beforeEach(function () {
      this.server.setup(null, 200, true);
    });

    it("returns the right response for a DELETE", function (done) {

      ajaxWrapper({
        method: "DELETE",
        url: config.apiURL + "/foo/bar",
        data: null
      })
        .success(response => {
          expectAsync(() => {
            expect(response.body.method).to.equal("DELETE");
          }, done);
        })
        .error(() => {
          done(new Error("I should not be called"));
        });
    });
  })

});
