const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const secrets = require('./secrets.json');

let APIKEY;
let APISECRET;

const DEV = false;
let pairs = {};

const shitCoinTicker = process.argv[2];
console.log(`SHITCOIN SELECTED: ${shitCoinTicker}`);

//Track how much we have bought. Subtract each time there is a sale
let cryptoQuantity;
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
    return binance.bookTickers(pair).then((err, data) => {
        if(err) return console.log(err);
        return data;
    })
}


/**
 * Returns crypto amount worth in dollars
 * @param {*} tickerSymbol - The crypto you want
 * @param {*} dollarAmount - The total in dollars
 */
const getCryptoAmountInDollars = (tickerSymbol, dollarAmount) => {
    return getAccountBalance().then(balance => {
        if(balance[tickerSymbol] && balance[tickerSymbol].available > 0){
            const pair = tickerSymbol + "USDT";
            return getSinglePair(pair).then(data => {
                console.log(`Pair data: ${data}`);
                return dollarAmount / data;
            })
        } else {
            console.log("You don't have enough balance")
        }
    })
};

const subscribeToTrades = (tickerSymbolPair) => {
    binance.websockets.trades([tickerSymbolPair], (trades) => {
        let {e:eventType, E:eventTime, s:symbol, p:price, q:quantity, m:maker, a:tradeId} = trades;
        console.info(symbol+" trade update. price: "+price+", quantity: "+quantity+", maker: "+maker);
    });
};

const doesPairExistWithBtc = (pair) => {
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

// Enter ticker to buy. Get amount in btc to purchase. Set stop loss.
// set milestone % profit take + stop loss when order fulfilled
const yoloTron5000 = (tickerSymbol) => {
    // Find out how much $100 is in btc
    return getCryptoAmountInDollars("BTC", 100).then(data => {
        const btcInDollars = data;
        const pair = tickerSymbol + "BTC";
        // Check if the input ticker is valid
        if(doesPairExistWithBtc(pair)){
            // calculate how many crypto you can buy with $100 in btc
            const quantity = btcInDollars / priceOfCrypto;
            cryptoQuantity = quantity;
            return getPriceInfo(pair).then(data => {
                const initialPrice = data.bidPrice;
                return binance.buy(pair, quantity, initialPrice, {type:'LIMIT'}, (error, response) => {
                    if(response.status === "FILLED"){
                        setStopLoss(initialPrice, pair);
                        cryptoQuantity = response.exeutedQty;
                        // Setup profit taking and stop losses in callbacks
                        let profitPrice = getLimitOrderPrice(initialPrice, 50);
                        binance.buy(pair, cryptoQuantity * 0.1, profitPrice, {type:'TAKE_PROFIT'}, (error, response) => {
                            cryptoQuantity = cryptoQuantity - response.exeutedQty;
                            setStopLoss(response.price, pair);
                        });

                        profitPrice = getLimitOrderPrice(initialPrice, 100);
                        binance.buy(pair, cryptoQuantity * 0.1, profitPrice, {type:'TAKE_PROFIT'}, (error, response) => {
                            cryptoQuantity = cryptoQuantity - response.exeutedQty;
                            setStopLoss(response.price, pair);
                        });

                        profitPrice = getLimitOrderPrice(initialPrice, 150);
                        binance.buy(pair, cryptoQuantity * 0.20, profitPrice, {type:'TAKE_PROFIT'}, (error, response) => {
                            cryptoQuantity = cryptoQuantity - response.exeutedQty;
                            setStopLoss(response.price, pair);
                        });

                        profitPrice = getLimitOrderPrice(initialPrice, 200);
                        binance.buy(pair, cryptoQuantity * 0.30, profitPrice, {type:'TAKE_PROFIT'}, (error, response) => {
                            cryptoQuantity = cryptoQuantity - response.exeutedQty;
                            setStopLoss(response.price, pair);
                        });

                        //sell it all
                        profitPrice = getLimitOrderPrice(initialPrice, 300);
                        return binance.buy(pair, cryptoQuantity, initialPrice, {type:'TAKE_PROFIT'}, (error, response) => {
                            cryptoQuantity = cryptoQuantity - response.exeutedQty;
                            setStopLoss(response.price, pair);
                        });

                    }
                });
            })
        }
        console.log(`Pair ${pair} does not exist`);
    })
}

//// TEST FUNCTIONS
// getSinglePair("BTCUSDT").then(data => console.log(data))
// getAccountBalance().then(data => console.log(data))
// getCryptoAmountInDollars("BTC", 100).then(data => console.log(data))
// getAllPairs();


