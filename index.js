const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const secrets = require('./secrets.json');

let APIKEY;
let APISECRET

const DEV = false;
let pairs = {};

console.log(`DEVMODE: ${DEV}`);

const setApiKeySecret = () => {
    if(DEV){
        APIKEY = secrets.DEV.APIKEY;
        APISECRET = secrets.DEV.APISECRET  ;
    } else {
        APIKEY = secrets.PROD.APIKEY;
        APISECRET = secrets.PROD.APISECRET;
    }
}
setApiKeySecret();

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
        console.log(data);
        return data;
    })
};

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


// getSinglePair("BTCUSDT").then(data => console.log(data))
// getAccountBalance().then(data => console.log(data))
// getCryptoAmountInDollars("BTC", 100).then(data => console.log(data))
// getAllPairs();


// getCryptoAmountInDollars("BTC", 100).then(data => {
//     console.log(data);
// })




// getBalance()

// binance.bookTickers('BNBBTC', (error, ticker) => {
//     console.info("bookTickers", ticker);
//     // console.log(ticker.askPrice)
//     binance.buy("BNBBTC", 0.01, ticker.askPrice, {type:'LIMIT'}, (error, response) => {
//         console.info("Limit Buy response", response);
//         console.info("order id: " + response.orderId);
//     });
// });


// const stopLossPrice = getStopLossPrice(0.00145290, 1);
// console.log(stopLossPrice);
// const limitOrderPrice = getLimitOrderPrice(0.00145290, 10)
// console.log(limitOrderPrice);

// first check how much bitcoin in dollars
// then get how much bitcoin is needed
