// micro provides http helpers
const { createError, json, send } = require('micro');
// microrouter provides http server routing
const { router, get, post } = require('microrouter');
// serve-handler serves static assets
const staticHandler = require('serve-handler');
// async-retry will retry failed API requests
const retry = require('async-retry');
const path = require('path');

// logger gives us insight into what's happening
const logger = require('./server/logger');
// schema validates incoming requests
const {
  validatePaymentPayload,
  validateCreateCardPayload,
} = require('./server/schema');
// square provides the API client and error types
const { SquareError, client: square } = require('./server/square');
const { isProduction } = require('./server/config');

async function getPayment(req, res) {
  logger.info(req);
  res.statusCode = 200; //
  res.setHeader('Content-Type', 'text/plain'); //
  res.end('Hello from the Node.js server!'); //
}

async function createPayment(req, res) {
  console.log('here');
  const payload = await json(req);
  // console.log(JSON.stringify(payload));
  // We validate the payload for specific fields. You may disable this feature
  // if you would prefer to handle payload validation on your own.
  if (!validatePaymentPayload(payload)) {
    throw createError(400, 'Bad Request');
  }

  await retry(async (bail, attempt) => {
    try {
      console.log('Creating payment', { attempt });
      console.log(
        'access token exists',
        Boolean(process.env.SQUARE_ACCESS_TOKEN),
      );

      const payment = {
        idempotencyKey: payload.idempotencyKey,
        locationId: payload.locationId,
        sourceId: payload.sourceId,
        amountMoney: {
          // the expected amount is in cents, meaning this is $1.00.
          amount: 100n,
          // If you are a non-US account, you must change the currency to match the country in which
          // you are accepting the payment.
          currency: 'USD',
        },
      };

      if (payload.customerId) {
        payment.customerId = payload.customerId;
      }

      // VerificationDetails is part of Secure Card Authentication.
      // This part of the payload is highly recommended (and required for some countries)
      // for 'unauthenticated' payment methods like Cards.
      if (payload.verificationToken) {
        payment.verificationToken = payload.verificationToken;
      }

      console.log(isProduction);
      const { payment: paymentResponse } =
        await square.payments.create(payment);
      console.log('Payment succeeded!', { paymentResponse });

      send(res, 200, {
        success: true,
        payment: {
          id: paymentResponse.id,
          status: paymentResponse.status,
          receiptUrl: paymentResponse.receiptUrl,
          orderId: paymentResponse.orderId,
        },
      });
    } catch (ex) {
      if (ex instanceof SquareError) {
        // likely an error in the request. don't retry
        console.error(ex.errors);
        bail(ex);
      } else {
        // IDEA: send to error reporting service
        logger.error(`Error creating payment on attempt ${attempt}: ${ex}`);
        throw ex; // to attempt retry
      }
    }
  });
}

async function storeCard(req, res) {
  const payload = await json(req);

  if (!validateCreateCardPayload(payload)) {
    throw createError(400, 'Bad Request');
  }

  await retry(async (bail, attempt) => {
    try {
      logger.debug('Storing card', { attempt });

      const cardReq = {
        idempotencyKey: payload.idempotencyKey,
        sourceId: payload.sourceId,
        card: {
          customerId: payload.customerId,
        },
      };

      if (payload.verificationToken) {
        cardReq.verificationToken = payload.verificationToken;
      }

      const { result, statusCode } = await square.cardsApi.createCard(cardReq);

      logger.info('Store Card succeeded!', { result, statusCode });

      // cast 64-bit values to string
      // to prevent JSON serialization error during send method
      result.card.expMonth = result.card.expMonth.toString();
      result.card.expYear = result.card.expYear.toString();
      result.card.version = result.card.version.toString();

      send(res, statusCode, {
        success: true,
        card: result.card,
      });
    } catch (ex) {
      if (ex instanceof SquareError) {
        // likely an error in the request. don't retry
        logger.error(ex.errors);
        bail(ex);
      } else {
        // IDEA: send to error reporting service
        logger.error(
          `Error creating card-on-file on attempt ${attempt}: ${ex}`,
        );
        throw ex; // to attempt retry
      }
    }
  });
}

// serve static files like index.html and favicon.ico from public/ directory
async function serveStatic(req, res) {
  logger.info('Handling request', req.path);
  try {
    await staticHandler(req, res, {
      public: path.join(__dirname, 'public'),
    });
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

// export routes to be served by micro
module.exports = router(
  post('/payment', createPayment),
  get('/payment', getPayment),
  post('/card', storeCard),
  get('/*', serveStatic),
);
