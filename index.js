const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const fs = require('fs');
const util = require('util');
const secrets = require('./secrets.json');

// input params
const amountInDollarsToBuy = process.argv[2];
if (!amountInDollarsToBuy) {
  throw new Error('Please pass an amount in dollars for the first param');
}
const shitCoinTicker = process.argv[3];
if (!shitCoinTicker) {
  throw new Error('Please pass a ticker for the second param');
}
const priceMultiplier = process.argv[4];
if (!priceMultiplier) {
  throw new Error('Please pass in a price multiplier for the third param');
}

// Running configs
let APIKEY;
let APISECRET;
const DEV = false;

console.log(`SHITCOIN SELECTED: ${shitCoinTicker}`);
console.log(`DOLLAR AMOUNT: ${amountInDollarsToBuy}`);
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

// Track how much we have bought. Subtract each time there is a sale
let cryptoQuantity;
let initialCryptoQuantity;
let currentCryptoQuantity;

// runtime vars
let previousStopLossOrderId = 0;
let tickSize;
let pairs = {};
const minimums = {};

// promisifyied methods
const binanceMarketBuyAsync = util.promisify(binance.marketBuy);
const binanceSellAsync = util.promisify(binance.sell);
const binanceCancelAsync = util.promisify(binance.cancel);

const getStopLossPrice = (orderPrice, percentage) => {
  console.log(`getStopLossPrice: orderPrice: ${orderPrice}, percentage: ${percentage}`);
  const onePercent = orderPrice / 100;
  const priceDiff = onePercent * percentage;
  const unrounded = orderPrice - priceDiff;
  console.log(`getStopLossPrice: Unrounded Stop Loss Price: ${unrounded}`);
  const rounded = binance.roundTicks(unrounded, tickSize);
  console.log(`getStopLossPrice: Rounded Stop Loss Price: ${rounded}`);
  return rounded;
};

const getLimitOrderPrice = (orderPrice, percentage) => {
  console.log(`getLimitOrderPrice: orderPrice: ${orderPrice}, percentage: ${percentage}`);
  const onePercent = orderPrice / 100;
  const priceDiff = onePercent * percentage;
  const unrounded = orderPrice + priceDiff;
  console.log(`getLimitOrderPrice: Unrounded Limit Order Price: ${unrounded}`);
  const rounded = binance.roundTicks(unrounded, tickSize);
  console.log(`getLimitOrderPrice: Rounded Limit Order Price: ${rounded}`);
  return rounded;
};

const initPairs = async () => {
  pairs = await binance.prices();
};

const getSinglePair = async (pairTicker) => {
  console.log('getSinglePair: getting pair', pairTicker);
  const data = await binance.prices();
  console.log('getSinglePair:', data);
  return data[pairTicker];
};

const getAccountBalance = async () => {
  console.log('getAccountBalance: Getting account balance');
  const data = await binance.balance();
  console.log(data);
  return data;
};

const getPriceInfo = async (pair) => {
  console.log('getPriceInfo: Getting price info for', pair);
  const data = await binance.bookTickers(pair);
  console.log(data);
  return data;
};

/**
 * Returns crypto amount worth in dollars
 * @param {*} tickerSymbol - The crypto you want
 * @param {*} dollarAmount - The total in dollars
 */
const getCryptoAmountInDollars = async (tickerSymbol, dollarAmount) => {
  console.log('getCryptoAmountInDollars: Getting account balance');
  const balance = await getAccountBalance();
  if (balance[tickerSymbol] && balance[tickerSymbol].available > 0) {
    const pair = `${tickerSymbol}USDT`;
    const data = await getSinglePair(pair);
    console.log(`Pair data: ${data}`);
    return dollarAmount / data;
  }
  console.log("You don't have enough balance");
  return null;
};

// const subscribeToTrades = (tickerSymbolPair) => {
//   binance.websockets.trades([tickerSymbolPair], (trades) => {
//     const {
//       e: eventType, E: eventTime, s: symbol, p: price, q: quantity, m: maker, a: tradeId,
//     } = trades;
//     console.info(`${symbol} trade update. price: ${price}, quantity: ${quantity}, maker: ${maker}`);
//   });
// };

const doesPairExistWithBtc = (pair) => {
  console.log(`doesPairExistWithBtc: Checking ${pair} exists in pairs`);
  if (pairs[pair]) {
    return true;
  }
  return false;
};

const setStopLoss = async (orderPrice, pair) => {
  const stopLossPrice = getStopLossPrice(orderPrice, 1);
  const type = 'STOP_LOSS_LIMIT';
  console.log('setStopLoss: settng stop loss at price', stopLossPrice);
  try {
    const sellResponse = await binanceSellAsync(pair, cryptoQuantity, orderPrice, { stopPrice: stopLossPrice, type });
    console.log('setStopLoss response');
    console.log(sellResponse);
    if (previousStopLossOrderId !== 0) {
      console.log('setStopLoss: previousStopLossOrderId exists. cancelling old stop loss', previousStopLossOrderId);
      const cancelResponse = await binanceCancelAsync(pair, previousStopLossOrderId);
      console.log('setStopLoss: cancelResponse');
      console.log(cancelResponse);
    }
    previousStopLossOrderId = sellResponse.orderId;
  } catch (e) {
    console.log('setStopLoss err');
    console.log(e.body);
  }
};

const getTickerPrecisionData = async (ticker) => {
  console.log('getTickerPrecisionData: Getting ticker precision');
  const data = await binance.exchangeInfo();
  const symbolData = data.symbols.find((s) => s.symbol === ticker);
  console.log('getTickerPrecisionData: symbol data', symbolData);
  return symbolData;
};

// const generateRoundedQuantity = (btcInDollars, initialPrice, precisionData) => {
//   // https://github.com/jaggedsoft/node-binance-api/blob/master/examples/advanced.md
//   const { minQty, minNotional, stepSize } = precisionData;

//   let amount = (btcInDollars / initialPrice);
//   // Set minimum order amount with minQty
//   if (amount < minQty) {
//     return amount = minQty;
//   }

//   // Set minimum order amount with minNotional
//   if (initialPrice * amount < minNotional) {
//     return amount = minNotional / initialPrice;
//   }

//   // Round to stepSize
//   return amount = binance.roundStep(amount, stepSize);
// };

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
const yoloTron5000 = async (tickerSymbol) => {
  try {
    // Find out how much $100 is in btc'
    const btcInDollars = await getCryptoAmountInDollars('BTC', amountInDollarsToBuy);
    const pair = `${tickerSymbol}BTC`;
    // Check if the input ticker is valid
    if (!doesPairExistWithBtc(pair)) {
      console.log(`yoloTron5000: Pair ${pair} does not exist`);
      return;
    }
    console.log('yoloTron5000: pair exists');
    // calculate how many crypto you can buy with $100 in btc
    const priceInfo = await getPriceInfo(pair);
    const initialPrice = priceInfo.bidPrice;
    const precisionData = await getTickerPrecisionData(pair);
    const unroundedQuantity = btcInDollars / initialPrice;
    const roundedQuantity = createRoundedQuantity(unroundedQuantity, precisionData, initialPrice);

    tickSize = precisionData.filters.find((f) => f.filterType === 'PRICE_FILTER').tickSize;
    console.log('yoloTron5000: btc in dollars', btcInDollars);
    console.log('yoloTron5000: buying pair', pair);
    console.log('yoloTron5000: buying quantity', roundedQuantity);
    console.log('yoloTron5000: initialPrice', initialPrice);
    initialCryptoQuantity = roundedQuantity;
    const marketBuyRespons = await binanceMarketBuyAsync(pair, roundedQuantity);
    console.log('yoloTron5000: marketBuyRespons');
    console.log(marketBuyRespons);
  } catch (error) {
    console.log('yoloTron5000: err');
    console.log(error);
  }
  // return binance.buy(pair, roundedQuantity, initialPrice, {type:'LIMIT' }, (error, response) => {
  //     console.log('binance.buy response', response);
  //     if (error) {
  //         console.log('binance.buy error statusCode', error.statusCode);
  //         console.log('binance.buy error body', error.body);
  //     }
  //     if(response.status === "FILLED"){
  //         setStopLoss(initialPrice, pair);
  //         initialCryptoQuantity = response.executedQty;
  //         // Setup profit taking and stop losses in callbacks
  //         let profitPrice = getLimitOrderPrice(initialPrice, 2, tickSize);
  //         let roundedQuantity = createRoundedQuantity(initialCryptoQuantity * 0.5, precisionData, initialPrice);
  //         binance.sell(pair, roundedQuantity, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
  //             if (error) {
  //                 console.log('binance.sell error statusCode', error.statusCode);
  //                 console.log('binance.sell error body', error.body);
  //                 return;
  //             }
  //             console.log(`First sell: ${response}`)
  //             currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
  //             setStopLoss(response.price, pair);
  //         });

  //         profitPrice = getLimitOrderPrice(initialPrice, 4, tickSize);
  //         roundedQuantity = createRoundedQuantity(initialCryptoQuantity * 0.5, precisionData, initialPrice);
  //         return binance.sell(pair, roundedQuantity, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
  //             if (error) {
  //                 console.log('binance.sell error statusCode', error.statusCode);
  //                 console.log('binance.sell error body', error.body);
  //                 return;
  //             }
  //             console.log(`Second sell: ${response}`)
  //             currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
  //         });

  // profitPrice = getLimitOrderPrice(initialPrice, 150, tickSize);
  // binance.sell(pair, initialCryptoQuantity * 0.20, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
  //     currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
  //     setStopLoss(response.price, pair);
  // });

  // profitPrice = getLimitOrderPrice(initialPrice, 200, tickSize);
  // binance.sell(pair, initialCryptoQuantity * 0.30, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
  //     currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
  //     setStopLoss(response.price, pair);
  // });

  // //sell it all
  // profitPrice = getLimitOrderPrice(initialPrice, 300, tickSize);
  // return binance.sell(pair, currentCryptoQuantity, initialPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
  //     currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
  //     setStopLoss(response.price, pair);
  // });

  //     }
  // });
};

(async () => {
  await initPairs();
  await yoloTron5000(shitCoinTicker, amountInDollarsToBuy);
})();

binance.websockets.userData((err, resp) => {
  // console.log(resp);
  // console.log(err);
}, async (resp) => {
  console.log('resp', resp);

  const status = resp.x;
  const side = resp.S;
  const type = resp.o;
  const quantity = resp.q;
  const price = resp.L;
  const pair = resp.s;

  console.log(`binance.websockets.userData: Order created. SIDE: ${side}\nTYPE: ${type}\nSTATUS: ${status}\nQUANT: ${quantity}\nPRICE: ${price}`);

  switch (status) {
    case 'NEW':
    case 'CANCELLED':
    case 'REPLACED':
    case 'REJECTED':
    case 'TRADE':
      if (side === 'BUY' && price > 0) {
        try {
          cryptoQuantity = quantity;
          await setStopLoss(price, pair);
          console.log('binance.websockets.userData setting sell order');
          console.log('binance.websockets.userData pair', pair);
          console.log('binance.websockets.userData pair', quantity);
          console.log('binance.websockets.userData price * 2', price * priceMultiplier);
          console.log('binance.websockets.userData stopPrice', (price * priceMultiplier) - tickSize);
          const sellResponse = await binanceSellAsync(pair, quantity, price * priceMultiplier, { stopPrice: (price * priceMultiplier) - tickSize, type: 'TAKE_PROFIT_LIMIT' });
          console.log('binance.websockets.userData binance.sell response:');
          console.log(sellResponse);
        } catch (error) {
          console.log('binance.websockets.userData binance.sell error statusCode', error.statusCode);
          console.log('binance.websockets.userData binance.sell error body', error.body);
        }
      } else {
        // ignore ?
      }
    case 'EXPIRED':
    default:
      break;
  }
});

// const amountInDollarsToBuy = process.argv[2];
// const shitCoinTicker = process.argv[3];

// yoloTron5000(shitCoinTicker, amountInDollarsToBuy);

// binance.prevDay("ETHBTC", (error, prevDay, symbol) => {
//     console.info(symbol+" previous day:", prevDay);
//     // console.info("BNB change since yesterday: "+prevDay+"%")
//     console.log(prevDay.priceChangePercent)
//   });
