"use strict";

const generatedHandler = require("./handler");

module.exports = generatedHandler.handler;
module.exports.handler = generatedHandler.handler;
module.exports.default = generatedHandler.handler;
module.exports.runServerless = generatedHandler.runServerless;
