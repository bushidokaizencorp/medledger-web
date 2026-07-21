'use strict';
/** Single shared Knex instance for the whole app. */
const knex = require('knex');
const config = require('./knexfile');

const db = knex(config);

module.exports = db;
