const { toBaseUnit, soliditySha3, BN, Web3 } = MuonAppUtils

const HttpProvider = Web3.providers.HttpProvider

const CHAINS = {
    mainnet: 1,
    fantom: 250,
}

const networksWeb3 = {
    [CHAINS.mainnet]: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_ETH)),
    [CHAINS.fantom]: new Web3(new HttpProvider(process.env.WEB3_PROVIDER_FTM)),
}

const networksBlocks = {
    [CHAINS.mainnet]: {
        'seed': 135,
        'fuse': 6467,
    },
    [CHAINS.fantom]: {
        'seed': 1475,
        'fuse': 70819,
    }
}

const THRESHOLD = 2
const PRICE_TOLERANCE = '0.0005'
const FUSE_PRICE_TOLERANCE = '0.1'
const Q112 = new BN(2).pow(new BN(112))
const ETH = new BN(toBaseUnit('1', '18'))

const UNISWAPV2_PAIR_ABI = [{ "constant": true, "inputs": [], "name": "getReserves", "outputs": [{ "internalType": "uint112", "name": "_reserve0", "type": "uint112" }, { "internalType": "uint112", "name": "_reserve1", "type": "uint112" }, { "internalType": "uint32", "name": "_blockTimestampLast", "type": "uint32" }], "payable": false, "stateMutability": "view", "type": "function" }, { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "uint112", "name": "reserve0", "type": "uint112" }, { "indexed": false, "internalType": "uint112", "name": "reserve1", "type": "uint112" }], "name": "Sync", "type": "event" }]

module.exports = {
    APP_NAME: 'price_feed',
    APP_ID: 26,
    REMOTE_CALL_TIMEOUT: 30000,


    isPriceToleranceOk: function (price, expectedPrice, priceTolerance) {
        let priceDiff = new BN(price).sub(new BN(expectedPrice)).abs()
        const priceDiffPercentage = new BN(priceDiff).mul(ETH).div(new BN(expectedPrice))
        return {
            isOk: !priceDiffPercentage.gt(toBaseUnit(priceTolerance, '18')),
            priceDiffPercentage: priceDiffPercentage.mul(new BN(100)).div(ETH)
        }
    },

    calculateInstantPrice: function (reserve0, reserve1) {
        // multiply reserveA into Q112 for precision in division 
        // reserveA * (2 ** 112) / reserverB
        const price0 = (new BN(reserve1)).mul(Q112).div(new BN(reserve0))
        return price0
    },

    getSeed: async function (chainId, pairAddress, period, toBlock) {
        const w3 = networksWeb3[chainId]
        const seedBlockNumber = toBlock - networksBlocks[chainId][period]

        const pair = new w3.eth.Contract(UNISWAPV2_PAIR_ABI, pairAddress)
        const { _reserve0, _reserve1 } = await pair.methods.getReserves().call(seedBlockNumber)
        const price0 = this.calculateInstantPrice(_reserve0, _reserve1)
        return { price0: price0, blockNumber: seedBlockNumber }

    },

    getSyncEvents: async function (chainId, seedBlockNumber, pairAddress) {
        const w3 = networksWeb3[chainId]
        const pair = new w3.eth.Contract(UNISWAPV2_PAIR_ABI, pairAddress)
        const options = {
            fromBlock: seedBlockNumber + 1,
            toBlock: seedBlockNumber + networksBlocks[chainId]['seed']
        }
        const syncEvents = await pair.getPastEvents("Sync", options)
        let syncEventsMap = {}
        // {key: event.blockNumber => value: event}
        syncEvents.forEach((event) => syncEventsMap[event.blockNumber] = event)
        return syncEventsMap
    },

    createPrices: function (chainId, seed, syncEventsMap) {

        let prices = [seed.price0]
        let price = seed.price0
        // fill prices and consider a price for each block between seed and current block
        for (let blockNumber = seed.blockNumber + 1; blockNumber <= seed.blockNumber + networksBlocks[chainId]['seed']; blockNumber++) {
            // use block event price if there is an event for the block
            // otherwise use last event price
            if (syncEventsMap[blockNumber]) {
                const { reserve0, reserve1 } = syncEventsMap[blockNumber].returnValues
                price = this.calculateInstantPrice(reserve0, reserve1)
            }
            prices.push(price)
        }
        return prices
    },

    std: function (arr) {
        let mean = arr.reduce((result, el) => result.add(el), new BN(0)).div(new BN(arr.length))
        arr = arr.map((k) => k.sub(mean).pow(new BN(2)))
        let sum = arr.reduce((result, el) => result.add(el), new BN(0))
        let variance = sum.div(new BN(arr.length))
        return BigInt(Math.sqrt(variance))
    },

    removeOutlierZScore: function (prices) {
        const mean = this.calculateAveragePrice(prices)
        // calculate std(standard deviation)
        const std0 = this.std(prices)
        if (std0 == 0) return prices

        let result = []
        // Z score = (price - mean) / std
        // price is not reliable if Z score < threshold
        prices.forEach((price) => price.sub(mean).div(new BN(std0)).abs() < THRESHOLD ? result.push(price) : {})
        return result

    },

    removeOutlier: function (prices) {
        const logPrices = []
        prices.forEach((price) => {
            logPrices.push(new BN(BigInt(Math.round(Math.log(price)))));
        })
        let logOutlierRemoved = this.removeOutlierZScore(logPrices)

        logOutlierRemoved = this.removeOutlierZScore(logOutlierRemoved)

        const outlierRemoved = []
        prices.forEach((price, index) => logOutlierRemoved.includes(logPrices[index]) ? outlierRemoved.push(price) : {})

        return outlierRemoved
    },

    calculateAveragePrice: function (prices, returnReverse) {
        let fn = function (result, el) {
            return returnReverse ? { price0: result.price0.add(el), price1: result.price1.add(Q112.mul(Q112).div(el)) } : result.add(el)
        }
        const sumPrice = prices.reduce(fn, returnReverse ? { price0: new BN(0), price1: new BN(0) } : new BN(0))
        const averagePrice = returnReverse ? { price0: sumPrice.price0.div(new BN(prices.length)), price1: sumPrice.price1.div(new BN(prices.length)) } : sumPrice.div(new BN(prices.length))
        return averagePrice
    },

    checkFusePrice: async function (chainId, pairAddress, price, toBlock) {
        const fusePrice = await this.getSeed(chainId, pairAddress, 'fuse', toBlock)
        const checkResult = this.isPriceToleranceOk(price.price0, fusePrice.price0, FUSE_PRICE_TOLERANCE)
        return {
            isOk: checkResult.isOk,
            priceDiffPercentage: checkResult.priceDiffPercentage,
            block: fusePrice.blockNumber
        }
    },

    onRequest: async function (request) {
        let {
            method,
            data: { params }
        } = request

        switch (method) {
            case 'signature':

                let { chain, pairAddress, toBlock } = params
                if (!chain) throw { message: 'Invalid chain' }

                const chainId = CHAINS[chain]
                const w3 = networksWeb3[chainId]
                const currentBlockNumber = await w3.eth.getBlockNumber()
                if (!toBlock) toBlock = currentBlockNumber
                else if (toBlock > currentBlockNumber) throw { message: 'Invalid Block Number' }

                // get seed price
                const seed = await this.getSeed(chainId, pairAddress, 'seed', toBlock)
                // get sync events that are emitted after seed block
                const syncEventsMap = await this.getSyncEvents(chainId, seed.blockNumber, pairAddress)
                // create an array contains a price for each block mined after seed block 
                const prices = this.createPrices(chainId, seed, syncEventsMap)
                // remove outlier prices
                const reliablePrices = this.removeOutlier(prices)
                // calculate the average price
                const price = this.calculateAveragePrice(reliablePrices, true)
                // check for high price change in comparison with fuse price
                const fuse = await this.checkFusePrice(chainId, pairAddress, price, toBlock)
                if (!fuse.isOk) throw { message: `High price gap (${fuse.priceDiffPercentage}%) between fuse and twap price for ${pairAddress} in block range ${fuse.block} - ${seed.blockNumber + networksBlocks[chainId]['seed']}` }

                return {
                    chain: chain,
                    pairAddress: pairAddress,
                    price0: price.price0.toString(),
                    price1: price.price1.toString(),
                    toBlock: toBlock,
                }

            default:
                throw { message: `Unknown method ${params}` }
        }
    },

    hashRequestResult: function (request, result) {
        let {
            method,
            data: { params }
        } = request
        switch (method) {
            case 'signature': {

                let { chain, pairAddress, price0, price1, toBlock } = result

                // node1 result
                let [expectedPrice0, expectedPrice1] = [request.data.result.price0, request.data.result.price1];
                // check price difference between current node and node1
                // throw error in case of high price difference between current node and node1
                if (!this.isPriceToleranceOk(price0, expectedPrice0, PRICE_TOLERANCE).isOk)
                    throw { message: 'Price threshold exceeded' }

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'address', value: pairAddress },
                    { type: 'uint256', value: expectedPrice0 },
                    { type: 'uint256', value: expectedPrice1 },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp },
                    { type: 'uint256', value: toBlock },
                ])

            }
            default:
                return null
        }
    }
}
