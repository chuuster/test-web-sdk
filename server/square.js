const { SquareError, SquareClient } = require('square');

const { SQUARE_ACCESS_TOKEN } = require('./config');

const client = new SquareClient({
  environment: 'https://connect.squareup.com',
  token: SQUARE_ACCESS_TOKEN,
});

module.exports = { SquareError, client };
