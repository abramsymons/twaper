const { soliditySha3, BN } = MuonAppUtils
const PriceFeed = require('./price_feed')

const {
    CHAINS,
    networksWeb3,
    Q112
} = PriceFeed

const CONFIG_ADDRESSES = {
    [CHAINS.mainnet]: '',
    [CHAINS.fantom]: '',
}

const CONFIG_ABI = [{ "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "bool", "name": "dynamicWeight", "type": "bool" }], "name": "getRoutes", "outputs": [{ "components": [{ "internalType": "uint256", "name": "index", "type": "uint256" }, { "internalType": "string", "name": "dex", "type": "string" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "bool[]", "name": "reversed", "type": "bool[]" }, { "internalType": "uint256", "name": "weight", "type": "uint256" }, { "internalType": "bool", "name": "isActive", "type": "bool" }], "internalType": "struct IOracleAggregator.Route[]", "name": "", "type": "tuple[]" }], "stateMutability": "view", "type": "function" },]
const PRICE_GAP = toBaseUnit('0.01', 18)

module.exports = {
    ...PriceFeed,

    APP_NAME: 'token_price_feed',
    APP_ID: 100,
    REMOTE_CALL_TIMEOUT: 30000,


    getRoute: async function (chainId, token) {
        const w3 = networksWeb3[chainId]
        const config = new w3.eth.Contract(CONFIG_ABI, CONFIG_ADDRESSES[chainId])
        const routes = await config.methods.getRoutes(token, true).call()
        return routes.map((route) => {
            return {
                dex: route.dex,
                path: route.path,
                reversed: route.reversed,
                weight: route.weight
            }
        })
    },

    getTokenPairPrice: async function (chainId, pairAddress, reversed, toBlock) {
        let pairPrice = await this.calculatePairPrice(chainId, pairAddress, toBlock)
        return new BN(reversed ? new BN(pairPrice.price1) : new BN(pairPrice.price0))
    },

    calculatePrice: async function (chainId, routes, toBlock) {
        var zip = (a, b) => a.map((x, i) => [x, b[i]]);
        let tokenPairPrice

        let sumTokenPrice = new BN(0)
        let sumWeights = new BN(0)
        let prices = []
        for (let route of routes) {
            let price = Q112
            for (let [pairAddress, reversed] of zip(route.path, route.reversed)) {
                tokenPairPrice = await this.getTokenPairPrice(chainId, pairAddress, reversed, toBlock)
                price = price.mul(tokenPairPrice).div(Q112)
            }
            sumTokenPrice = sumTokenPrice.add(price.mul(new BN(route.weight)))
            sumWeights = sumWeights.add(new BN(route.weight))
            prices.push(price)
        }
        let [minPrice, maxPrice] = [BN.min(...prices), BN.max(...prices)]
        if (maxPrice.sub(minPrice).mul(Q112).div(minPrice).gt(PRICE_GAP))
            throw { message: `High price gap between route prices` }
        return sumTokenPrice.div(sumWeights)
    },

    onRequest: async function (request) {
        let {
            method,
            data: { params }
        } = request

        switch (method) {
            case 'signature':

                let { chain, token } = params
                if (!chain) throw { message: 'Invalid chain' }

                const chainId = CHAINS[chain]
                const w3 = networksWeb3[chainId]
                let toBlock
                if (!request.data.result) toBlock = await w3.eth.getBlockNumber()
                else toBlock = request.data.result.toBlock

                // get token route for calculating price
                const routes = await this.getRoute(chainId, token)
                if (!routes) throw { message: 'Invalid token' }
                // calculate price using the given route
                const price = await this.calculatePrice(chainId, routes, toBlock)

                return {
                    chain: chain,
                    token: token,
                    routes: routes,
                    price: price.toString(),
                    toBlock: toBlock
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

                let { chain, token, price } = result

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'address', value: token },
                    { type: 'uint256', value: price },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}
