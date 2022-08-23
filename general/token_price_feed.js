const { soliditySha3, BN } = MuonAppUtils
const { isPriceToleranceOk } = require('./price_feed')

const CHAINS = {
    mainnet: 1,
    fantom: 250,
}

const ROUTES = {
    [CHAINS.mainnet]: {
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984': {
            route: ['0xEBFb684dD2b01E698ca6c14F10e4f289934a54D6'],
            reversed: [0]
        }
    },
    [CHAINS.fantom]: {
        '0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44': {
            route: ['0x2599Eba5fD1e49F294C76D034557948034d6C96E', '0xe7E90f5a767406efF87Fdad7EB07ef407922EC1D'],
            reversed: [1, 1]
        },
    }
}

const PRICE_TOLERANCE = '0.0005'
const Q112 = new BN(2).pow(new BN(112))


module.exports = {
    APP_NAME: 'token_price_feed',
    APP_ID: 100,
    REMOTE_CALL_TIMEOUT: 30000,


    getRoute: function (chainId, token) {
        return ROUTES[chainId][token]
    },

    getTokenPairPrice: async function (chain, pairAddress, reversed) {
        let request = {
            method: 'signature',
            data: {
                params: { chain, pairAddress }
            }
        }

        let pairPrice = await this.invoke("price_feed", "onRequest", request)
        return new BN(reversed ? new BN(pairPrice.price1) : new BN(pairPrice.price0))
    },

    calculatePrice: async function (chain, route) {
        let price = Q112
        let tokenPairPrice
        var zip = (a, b) => a.map((x, i) => [x, b[i]]);

        for (let [pairAddress, reversed] of zip(route.route, route.reversed)) {
            tokenPairPrice = await this.getTokenPairPrice(chain, pairAddress, reversed)
            price = price.mul(tokenPairPrice).div(Q112)
        }
        return price
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

                // get token route for calculating price
                const route = this.getRoute(chainId, token)
                if (!route) throw { message: 'Invalid token' }
                // calculate price using the given route
                const price = await this.calculatePrice(chain, route)

                return {
                    chain: chain,
                    token: token,
                    route: route.route,
                    price: price.toString()
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

                let { chain, token, route, price } = result

                const expectedPrice = request.data.result.price

                if (!isPriceToleranceOk(price, expectedPrice, PRICE_TOLERANCE).isOk) throw { message: 'Price threshold exceeded' }

                return soliditySha3([
                    { type: 'uint32', value: this.APP_ID },
                    { type: 'address', value: token },
                    { type: 'address[]', value: route },
                    { type: 'uint256', value: expectedPrice },
                    { type: 'uint256', value: String(CHAINS[chain]) },
                    { type: 'uint256', value: request.data.timestamp }
                ])

            }
            default:
                return null
        }
    }
}