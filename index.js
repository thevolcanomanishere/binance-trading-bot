const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const secrets = require('./secrets.json');
const fs = require('fs');

let APIKEY;
let APISECRET;

const DEV = false;
let pairs = {};
let minimums = {};

const amountInDollarsToBuy = process.argv[2];
const shitCoinTicker = process.argv[3];

console.log(`SHITCOIN SELECTED: ${shitCoinTicker}`);
console.log(`DOLLAR AMOUNT: ${amountInDollarsToBuy}`);

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

const getStopLossPrice = (orderPrice, percentage, tickSize) => {
    const onePercent = orderPrice / 100;
    const priceDiff = onePercent * percentage;
    const unrounded = orderPrice - priceDiff;
    console.log(`Unrounded Stop Loss Price: ${unrounded}`);
    const rounded = binance.roundTicks(unrounded, tickSize);
    console.log(`Rounded Stop Loss Price: ${rounded}`);
    return rounded;
}

const getLimitOrderPrice = (orderPrice, percentage, tickSize) => {
    const onePercent = orderPrice / 100;
    const priceDiff = onePercent * percentage;
    const unrounded = orderPrice + priceDiff;
    console.log(`Unrounded Limit Order Price: ${unrounded}`);
    const rounded = binance.roundTicks(unrounded, tickSize);
    console.log(`Rounded Limit Order Price: ${rounded}`);
    return rounded;
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
        console.log('Balanced retrieved');
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

    // https://github.com/jaggedsoft/node-binance-api/blob/master/examples/advanced.md
    const { minQty, minNotional, stepSize } = precisionData;

    let amount = (btcInDollars / initialPrice);
    // Set minimum order amount with minQty
    if ( amount < minQty ) {
        return amount = minQty;
    }

    // Set minimum order amount with minNotional
    if ( initialPrice * amount < minNotional ) {
        return amount = minNotional / initialPrice;
    }

    // Round to stepSize
    return amount = binance.roundStep(amount, stepSize);
}

const createRoundedQuantity = (unroundedQuantity, precisionData, price) => {

    const { minQty, stepSize } = precisionData.filters.find(f => f.filterType === "LOT_SIZE");
    const { minNotional } = precisionData.filters.find(f => f.filterType === "MIN_NOTIONAL")

    if ( unroundedQuantity < minQty ) {
        return minQty;
    }

    // Set minimum order amount with minNotional
    if ( unroundedQuantity < minNotional ) {
        return minNotional / price;
    }

    // Round to stepSize
    return binance.roundStep(unroundedQuantity, stepSize);

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
            return getPriceInfo(pair).then(priceInfo => {
                console.log('got price info', priceInfo);
                const initialPrice = priceInfo.bidPrice; // CHANGE THIS BACK TO bidPrice
                return getTickerPrecisionData(pair).then((precisionData) => {
                    const unroundedQuantity = btcInDollars / initialPrice;
                    const roundedQuantity = createRoundedQuantity(unroundedQuantity, precisionData, initialPrice);

                    const { tickSize } = precisionData;
                    console.log('btc in dollars', btcInDollars);
                    console.log('buying pair', pair);
                    console.log('buying quantity', roundedQuantity);
                    console.log('initialPrice', initialPrice);
                    initialCryptoQuantity = roundedQuantity;
                    return binance.buy(pair, roundedQuantity, initialPrice, {type:'LIMIT' }, (error, response) => {
                        console.log('binance.buy response', response);
                        if (error) {
                            console.log('binance.buy error statusCode', error.statusCode);
                            console.log('binance.buy error body', error.body);
                        }
                        if(response.status === "FILLED"){
                            setStopLoss(initialPrice, pair);
                            initialCryptoQuantity = response.executedQty;
                            // Setup profit taking and stop losses in callbacks
                            let profitPrice = getLimitOrderPrice(initialPrice, 2, tickSize);
                            let roundedQuantity = createRoundedQuantity(initialCryptoQuantity * 0.5, precisionData, initialPrice);
                            binance.sell(pair, roundedQuantity, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                if (error) {
                                    console.log('binance.sell error statusCode', error.statusCode);
                                    console.log('binance.sell error body', error.body);
                                    return;
                                }
                                console.log(`First sell: ${response}`)
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                                setStopLoss(response.price, pair);
                            });

                            profitPrice = getLimitOrderPrice(initialPrice, 4, tickSize);
                            roundedQuantity = createRoundedQuantity(initialCryptoQuantity * 0.5, precisionData, initialPrice);
                            return binance.sell(pair, roundedQuantity, profitPrice, {type:'TAKE_PROFIT_LIMIT'}, (error, response) => {
                                if (error) {
                                    console.log('binance.sell error statusCode', error.statusCode);
                                    console.log('binance.sell error body', error.body);
                                    return;
                                }
                                console.log(`Second sell: ${response}`)
                                currentCryptoQuantity = currentCryptoQuantity - response.executedQty;
                            });

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

                        }
                    });

                });
            })
        } else {
            console.log(`Pair ${pair} does not exist`);
        }
    })
}

binance.websockets.userData((err, resp) => {
    // console.log(resp);
    // console.log(err);
}, (err, resp) => {
    if(err) console.log(err);
    console.log(resp);

    const status = resp.X;
    const side = resp.S;
    const type = resp.o;
    const quantity = resp.q;
    const price = resp.p;
    switch (status) {
        case "NEW":
            console.log(`Order created. SIDE: ${side}\nTYPE: ${type}\nSTATUS: ${status}QUANT: ${quantity}\nPRICE: ${price}`)
        case "CANCELLED":
        case "REPLACED":
        case "REJECTED":
        case "TRADE":
        case "EXPIRED":
        default:
        break;
    }
})
