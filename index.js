const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const fs = require('fs');
const secrets = require('./secrets.json');

let APIKEY;
let APISECRET;

const DEV = false;
let pairs = {};
let tickSize;

const amountInDollarsToBuy = process.argv[2];
const shitCoinTicker = process.argv[3];

console.log(`SHITCOIN SELECTED: ${shitCoinTicker}`);
console.log(`DOLLAR AMOUNT: ${amountInDollarsToBuy}`);

// Track how much we have bought. Subtract each time there is a sale
let cryptoQuantity;
let previousStopLossOrderId = 0;

console.log(`DEVMODE: ${DEV}`);

if (DEV) {
  APIKEY = secrets.DEV.APIKEY;
  APISECRET = secrets.DEV.APISECRET;
} else {
  APIKEY = secrets.PROD.APIKEY;
  APISECRET = secrets.PROD.APISECRET;
}

const setTestUrls = (isDev) => {
  if (isDev) {
    return {
      base: 'https://testnet.binance.vision/api/',
      combineStream: 'wss://testnet.binance.vision/stream?streams=',
      stream: 'wss://testnet.binance.vision/ws/',
    };
  }
  return {};
};

const binance = new Binance().options({
  APIKEY,
  APISECRET,
  test: DEV,
  verbose: true,
  urls: setTestUrls(DEV),
});

const getStopLossPrice = (orderPrice, percentage) => {
  const onePercent = orderPrice / 100;
  const priceDiff = onePercent * percentage;
  const unrounded = orderPrice - priceDiff;
  console.log(`Unrounded Stop Loss Price: ${unrounded}`);
  const rounded = binance.roundTicks(unrounded, tickSize);
  console.log(`Rounded Stop Loss Price: ${rounded}`);
  return rounded;
};

const getLimitOrderPrice = (orderPrice, percentage) => {
  const onePercent = orderPrice / 100;
  const priceDiff = onePercent * percentage;
  const unrounded = orderPrice + priceDiff;
  console.log(`Unrounded Limit Order Price: ${unrounded}`);
  const rounded = binance.roundTicks(unrounded, tickSize);
  console.log(`Rounded Limit Order Price: ${rounded}`);
  return rounded;
};

const getAllPairs = () => binance.prices().then((data) => {
  // console.log(data);
  pairs = data;
});

getAllPairs();

const getSinglePair = (pairTicker) => binance.prices().then((data) => data[pairTicker]);

const getAccountBalance = () => binance.balance().then((data) => data);

const getPriceInfo = (pair) => {
  console.log('Getting price info for', pair);
  return binance.bookTickers(pair).then((data) => data);
};

/**
 * Returns crypto amount worth in dollars
 * @param {*} tickerSymbol - The crypto you want
 * @param {*} dollarAmount - The total in dollars
 */
const getCryptoAmountInDollars = (tickerSymbol, dollarAmount) => {
  console.log('Getting account balance');
  return getAccountBalance().then((balance) => {
    console.log('Balanced retrieved');
    if (balance[tickerSymbol] && balance[tickerSymbol].available > 0) {
      const pair = `${tickerSymbol}USDT`;
      return getSinglePair(pair).then((data) => {
        console.log(`Pair data: ${data}`);
        return dollarAmount / data;
      });
    }
    console.log("You don't have enough balance");
  }).catch((e) => {
    console.log('error getting balance', e);
  });
};

const doesPairExistWithBtc = (pair) => {
  console.log(`Checking ${pair} exists in pairs`);
  if (pairs[pair]) {
    return true;
  }
  return false;
};

const setStopLoss = (orderPrice, percentageDecrease, pair) => {
  const stopLossPrice = getStopLossPrice(orderPrice, percentageDecrease);
  const type = 'STOP_LOSS';
  console.log('settng stop loss at price', stopLossPrice);
  return binance.sell(pair, cryptoQuantity, orderPrice, { stopPrice: stopLossPrice, type }, (err, resp) => {
    if (!err) {
      if (previousStopLossOrderId !== 0) {
        // cancel old stop loss
        return binance.cancel(pair, previousStopLossOrderId, (error, response, symbol) => {
          console.info(`${symbol} cancel response:`, response);
        });
      }
      previousStopLossOrderId = resp.orderId;
    }
  });
};

const setTakeProfit = (orderPrice, percentageIncrease, pair, quantity) => {
  const takeProfitPrice = getLimitOrderPrice(orderPrice, percentageIncrease);
  console.log('Settng take profit at price: ', takeProfitPrice);
  console.log(`Percentage increase: ${percentageIncrease}%`);
  return binance.sell(pair, quantity, takeProfitPrice).catch((err) => {
    console.log(err.body);
  });
};

const getTickerPrecisionData = (ticker) => {
  console.log('Getting ticker precision');
  return binance.exchangeInfo().then((data) => {
    const symbolData = data.symbols.find((s) => s.symbol === ticker);
    console.log('symbol data', symbolData);
    return symbolData;
  });
};

const createRoundedQuantity = (unroundedQuantity, precisionData, price) => {
  const { minQty, stepSize } = precisionData.filters.find((f) => f.filterType === 'LOT_SIZE');
  const { minNotional } = precisionData.filters.find((f) => f.filterType === 'MIN_NOTIONAL');

  if (unroundedQuantity < minQty) {
    return minQty;
  }

  // Set minimum order amount with minNotional
  if (unroundedQuantity < minNotional) {
    return minNotional / price;
  }

  // Round to stepSize
  return binance.roundStep(unroundedQuantity, stepSize);
};

// Enter ticker to buy. Get amount in btc to purchase. Set stop loss.
// set milestone % profit take + stop loss when order fulfilled
const yoloTron5000 = (tickerSymbol) =>
// Find out how much $100 is in btc'
  getCryptoAmountInDollars('BTC', amountInDollarsToBuy).then((data) => {
    const btcInDollars = data;
    const pair = `${tickerSymbol}BTC`;
    // Check if the input ticker is valid
    if (doesPairExistWithBtc(pair)) {
      console.log('pair exists');
      // calculate how many crypto you can buy with $100 in btc
      return getPriceInfo(pair).then((priceInfo) => {
        console.log('got price info', priceInfo);
        const initialPrice = priceInfo.bidPrice; // CHANGE THIS BACK TO bidPrice
        return getTickerPrecisionData(pair).then((precisionData) => {
          const unroundedQuantity = btcInDollars / initialPrice;
          const roundedQuantity = createRoundedQuantity(unroundedQuantity, precisionData, initialPrice);

          const priceFilter = precisionData.filters.find((f) => f.filterType === 'PRICE_FILTER');
          tickSize = priceFilter.tickSize;
          console.log('btc in dollars', btcInDollars);
          console.log('buying pair', pair);
          console.log('buying quantity', roundedQuantity);
          console.log('initialPrice', initialPrice);
          return binance.marketBuy(pair, roundedQuantity).catch((err) => {
            console.error(err.body);
          });
        });
      });
    }
    console.log(`Pair ${pair} does not exist`);
  });

binance.websockets.userData(() => {
}, (resp) => {
  console.log('resp', resp);

  const status = resp.x;
  const side = resp.S;
  const type = resp.o;
  const quantity = resp.q;
  const price = resp.L;
  const pair = resp.s;

  console.log(`Order created. SIDE: ${side}\nTYPE: ${type}\nSTATUS: ${status}\nQUANT: ${quantity}\nPRICE: ${price}`);

  switch (status) {
    case 'NEW':
    case 'CANCELLED':
    case 'REPLACED':
    case 'REJECTED':
    case 'TRADE':
      if (side === 'BUY' && price > 0) {
        setStopLoss(price, pair);
        setTakeProfit();
        binance.sell(pair, quantity, getLimitOrderPrice(price * 1.02), { type: 'TAKE_PROFIT_LIMIT' }, (error, response) => {
          if (error) {
            console.log('binance.sell error statusCode', error.statusCode);
            console.log('binance.sell error body', error.body);
            return;
          }
          console.log(`Second sell: ${response}`);
        });
      } else {
        console.log('Yolo');
      }
      break;
    case 'EXPIRED':
    default:
      break;
  }
});

yoloTron5000(shitCoinTicker, amountInDollarsToBuy);

// binance.prevDay("ETHBTC", (error, prevDay, symbol) => {
//     console.info(symbol+" previous day:", prevDay);
//     // console.info("BNB change since yesterday: "+prevDay+"%")
//     console.log(prevDay.priceChangePercent)
//   });
