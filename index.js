const Binance = require('node-binance-api');
const log = require('single-line-log').stdout;
const secrets = require('./secrets.json');

let APIKEY;
let APISECRET

const DEV = true;

console.log(`DEVMODE: ${DEV}`);

console.log(secrets.DEV.APIKEY);

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

setTestUrls = (isDev) => {
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

const getBalance = async() => {
    await binance.useServerTime();
    binance.balance((error, balances) => {
        if ( error ) return console.error(error);
        console.log(balances)
        return balances;
    });
}

getBalance()

// const getCryptoAmountInEuro = async (tickerSymbol, euroAmount) => {
//     const balances = await getBalance();
// }




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

