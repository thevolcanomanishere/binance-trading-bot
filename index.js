const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const secrets = require('./secrets.json');
const fs = require('fs');

let APIKEY;
let APISECRET;

const DEV = true;
let pairs = {};
let minimums = {};

const amountInDollarsToBuy = process.argv[2];
const shitCoinTicker = process.argv[3];

console.log(`SHITCOIN SELECTED: ${shitCoinTicker}`);

//Track how much we have bought. Subtract each time there is a sale
let cryptoQuantity;
let initialCryptoQuantity;
let currentCryptoQuantity;
let previousStopLossOrderId = 0;

console.log(`DEVMODE: ${DEV}`);

if(DEV){
    APIKEY = secrets.DEV.APIKEY;
    APISECRET = secrets.DEV.APISECRET;
} else {
    APIKEY = secrets.PROD.APIKEY;
    APISECRET = secrets.PROD.APISECRET;
}  

const setTestUrls = (isDev) => {
    if(isDev){
        return {
            base: 'https://testnet.binance.vision/api/',
            combineStream: 'wss://testnet.binance.vision/stream?streams=',
            stream: 'wss://testnet.binance.vision/ws/'
         }
    }
    return {};
}

const binance = new Binance().options({
  APIKEY,
  APISECRET,
  test: DEV,
  verbose: true,
  urls: setTestUrls(DEV)
});

const getStopLossPrice = (orderPrice, percentage) => {
    const onePercent = orderPrice / 100;
    const priceDiff = onePercent * percentage;
    return orderPrice - priceDiff;
}

const getLimitOrderPrice = (orderPrice, percentage) => {
    const onePercent = orderPrice / 100;
    const priceDiff = onePercent * percentage;
    return orderPrice + priceDiff;
}

const getAllPairs = () => {
    return binance.prices().then(data => {
        // console.log(data);
        pairs = data;
    })
};

getAllPairs();

const getSinglePair = (pairTicker) => {
    return binance.prices().then(data => {
        return data[pairTicker];
    })
};

const getAccountBalance = () => {
    return binance.balance().then(data => {
        return data;
    })
}

const getPriceInfo = (pair) => {
    console.log('Getting price info for', pair);
    return binance.bookTickers(pair).then(data => {
        return data;
    })
}

/**
 * Returns crypto amount worth in dollars
 * @param {*} tickerSymbol - The crypto you want
 * @param {*} dollarAmount - The total in dollars
 */
const getCryptoAmountInDollars = (tickerSymbol, dollarAmount) => {
    console.log('Getting account balance');
    return getAccountBalance().then(balance => {
        console.log('balance', balance);
        if(balance[tickerSymbol] && balance[tickerSymbol].available > 0){
            const pair = tickerSymbol + "USDT";
            return getSinglePair(pair).then(data => {
                console.log(`Pair data: ${data}`);
                return dollarAmount / data;
            })
        } else {
            console.log("You don't have enough balance")
        }
    }).catch((e) => {
        console.log('error getting balance', e);
    })
};

const subscribeToTrades = (tickerSymbolPair) => {
    binance.websockets.trades([tickerSymbolPair], (trades) => {
        let {e:eventType, E:eventTime, s:symbol, p:price, q:quantity, m:maker, a:tradeId} = trades;
        console.info(symbol+" trade update. price: "+price+", quantity: "+quantity+", maker: "+maker);
    });
};

const doesPairExistWithBtc = (pair) => {
    console.log(`Checking ${pair} exists in pairs`);
    if(pairs[pair]){
        return true;
    }
    return false;
}

const setStopLoss = (orderPrice, pair) => {
    const stopLossPrice = getStopLossPrice(orderPrice, 1);
    let type = "STOP_LOSS";
    return binance.sell(pair, cryptoQuantity, orderPrice, {stopPrice: stopLossPrice, type: type}, (err, resp) => {
        if(!err){
            if(previousStopLossOrderId !== 0){
                // cancel old stop loss
                return binance.cancel(pair, previousStopLossOrderId, (error, response, symbol) => {
                    console.info(symbol+" cancel response:", response);
                });
            } else {
                previousStopLossOrderId = resp.orderId;
            }
        }
    });
}

const getTickerPrecisionData = (ticker) => {
    console.log('Getting ticker precision');
    return binance.exchangeInfo().then((data) => {
        const symbolData = data.symbols.find((s) => s.symbol === ticker);
        console.log('symbol data', symbolData);
        return symbolData;
    });
}

const generateRoundedQuantity = (btcInDollars, initialPrice, precisionData) => {
    /*
        https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#lot_size
        In order to pass the lot size, the following must be true for quantity/icebergQty:
        - quantity >= minQty
        - quantity <= maxQty
        - (quantity-minQty) % stepSize == 0
    */
    let quantity = (btcInDollars / initialPrice).toFixed(precisionData.quotePrecision)
    const lotSizeData = precisionData.filters.find((f) => f.filterType === 'LOT_SIZE');
    console.log('Lot size data', lotSizeData);
    if (quantity < lotSizeData.minQty) {
        throw new Error('minimum quantity not met');
    }
    if (quantity > lotSizeData.maxQty) {
        throw new Error('exceeds maximum quantity');
    }
    const remainder = (quantity - lotSizeData.minQty) % lotSizeData.stepSize;
    if (remainder !== 0) {
        quantity = (quantity - remainder).toFixed(precisionData.quotePrecision);
    }
    return quantity;
}

// Enter ticker to buy. Get amount in btc to purchase. Set stop loss.
// set milestone % profit take + stop loss when order fulfilled
const yoloTron5000 = (tickerSymbol) => {
    // Find out how much $100 is in btc'
    return getCryptoAmountInDollars("BTC", amountInDollarsToBuy).then(data => {
        const btcInDollars = data;
        const pair = tickerSymbol + "BTC";
        // Check if the input ticker is valid
        if(doesPairExistWithBtc(pair)){
            console.log('pair exists');
            // calculate how many crypto you can buy with $100 in btc
            return getPriceInfo(pair).then(data2 => {
                console.log('got price info', data2);
                const initialPrice = data2.askPrice; // CHANGE THIS BACK TO bidPrice
                return getTickerPrecisionData(pair).then((precisionData) => {
                    quantity = generateRoundedQuantity(btcInDollars, initialPrice, precisionData);
                    console.log('btc in dollars', btcInDollars);
                    console.log('buying pair', pair);
                    console.log('buying quantity', quantity);
                    console.log('initialPrice', initialPrice);
                    initialCryptoQuantity = quantity;
                    return binance.buy(pair, quantity, initialPrice, {type:'LIMIT' }, (error, response) => {
                        console.log('binance.buy response', response);
                        if (error) {
                            console.log('binance.buy error statusCode', error.statusCode);
                            console.log('binance.buy error body', error.body);
                        }
                        if(response.status === "FILLED"){
                            setStopLoss(initialPrice, pair);
                            initialCryptoQuantity = response.executedQty;
                            // Setup profit taking and stop losses in callbacks
                            let profitPrice = getLimitOrderPrice(initialPrice, 50);
                            binance.sell(pair, initialCryptoQuantity * 0.1, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                            profitPrice = getLimitOrderPrice(initialPrice, 100);
                            binance.sell(pair, initialCryptoQuantity * 0.1, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                            profitPrice = getLimitOrderPrice(initialPrice, 150);
                            binance.sell(pair, initialCryptoQuantity * 0.20, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                            profitPrice = getLimitOrderPrice(initialPrice, 200);
                            binance.sell(pair, initialCryptoQuantity * 0.30, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                            //sell it all
                            profitPrice = getLimitOrderPrice(initialPrice, 300);
                            return binance.sell(pair, initialCryptoQuantity, initialPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                        }
                    });

                });
            })
        } else {
            console.log(`Pair ${pair} does not exist`);
        }
    })
}

//// TEST FUNCTIONS
// getSinglePair("BTCUSDT").then(data => console.log(data))
// getAccountBalance().then(data => console.log(data))
// getCryptoAmountInDollars("BTC", 100).then(data => console.log(data))
// getAllPairs();
// getTickerPrecisionData(shitCoinTicker)

yoloTron5000(shitCoinTicker);

// return binance.exchangeInfo(function(error, data) {
// 	let minimums = {};
// 	for ( let obj of data.symbols ) {
// 		let filters = {status: obj.status};
// 		for ( let filter of obj.filters ) {
// 			if ( filter.filterType == "MIN_NOTIONAL" ) {
// 				filters.minNotional = filter.minNotional;
// 			} else if ( filter.filterType == "PRICE_FILTER" ) {
// 				filters.minPrice = filter.minPrice;
// 				filters.maxPrice = filter.maxPrice;
// 				filters.tickSize = filter.tickSize;
// 			} else if ( filter.filterType == "LOT_SIZE" ) {
// 				filters.stepSize = filter.stepSize;
// 				filters.minQty = filter.minQty;
// 				filters.maxQty = filter.maxQty;
// 			}
// 		}
// 		//filters.baseAssetPrecision = obj.baseAssetPrecision;
// 		//filters.quoteAssetPrecision = obj.quoteAssetPrecision;
// 		filters.orderTypes = obj.orderTypes;
// 		filters.icebergAllowed = obj.icebergAllowed;
// 		minimums[obj.symbol] = filters;
// 	}
// 	console.log(minimums);
// 	global.filters = minimums;
// });

