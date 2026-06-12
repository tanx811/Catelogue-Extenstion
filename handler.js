"use strict";

const bolticHandler = require("./serverless/boltic");

module.exports.handler = bolticHandler;
module.exports.default = bolticHandler;
module.exports.runServerless = bolticHandler.runServerless;

